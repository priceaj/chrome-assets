// Copyright (c) 2013 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/*
 * Overall design tradeoffs
 *
 * The previous code worked by:
 *  - listen to chrome.tabs.onUpdated
 *  - listen to chrome.tabs.onRemoved
 *  - keep global state of active tabs
 *  - use setTimeout timer to update active tabs
 * The problem with these is that they have no URL filtering system.  That
 * means we get called on every tab update/close and not the google tracker
 * ones.  We also have to stay resident the entire time even if we're never
 * used.  Very simple to implement, but runtime overhead is annoying.
 *
 * The current code has been reworked to use the new event system:
 *  - listen to chrome.webNavigation.onCommitted
 *  - use chrome.alarms to update active tabs
 *  - global state is saved in chrome.storage.local
 * This allows us to use URL filters which Chrome itself processes so we
 * never get called on tabs we don't care about.  It also allows Chrome to
 * shutdown the background state page after some time and free up resources.
 * For global state that we care about, we keep it in chrome.storage.local
 * and sync it as needed.
 */

/*
 * Current codeflow
 *
 * First we listen for new tabs with a URL filter.  This way we can assume
 * when we get called, we always want to generate the icon for this tab.
 *
 * Then we set an alarm to fire just after the current iteration ends.  Since
 * we don't have global state, we have to pack the tabId into the name of the
 * alarm itself.  Then when the alarm fires, we unpack the tabId and update
 * its icon.
 *
 * Since we no longer listen to tab close events, we have to make the alarm
 * code ignore tabs that no longer exist and then clear themselves.  This
 * runs the risk of a lot of chrome alarms being active (one per new tab that
 * visits a tracker) for tabs that have been closed.  For now, we handle this
 * by setting an alarm that runs "soon" after a new tab has been created that
 * cleans up all old alarms.  This should provide "good enough" coverage.
 *
 * Since we fetch the iteration data from the internet, that logic looks like:
 * - Load last cached data from chrome.storage into runtime globals.
 * - If data is available, draw the icon.
 * - Check to see if the data is stale and refresh from network as needed.
 * - If data is available, draw the icon.
 *
 * Note: There is a bug where the icon doesn't get set when a page that
 * gets instant loaded in the bg when the current page is the NTP.  See
 * http://crbug.com/168630
 */

var storage = chrome.storage.local;

/*
 * Main event / alarm logic.
 */

function tabIdToAlarmName(tabId) {
  // Pack the tabid into the name :)
  return 'refresh CrOS iteration icons:' + tabId;
}

function alarmNameToTabId(alarmName) {
  return parseInt(alarmName.split(':')[1]);
}

// When visiting a tracker page, show the icon.
chrome.webNavigation.onCommitted.addListener(function(e) {
  syncIterState(function() {
    // Set an alarm to update icon when the iteration changes.
    chrome.alarms.create(tabIdToAlarmName(e.tabId), {
      'when': iterState.end,
      'periodInMinutes': millisPerIter() / 1000 / 60
    });

    /*
     * Set the reaper alarm to run once in the near future.  Yes, this will
     * reset a previous reaper alarm, but that's OK.  This isn't super
     * important to run all the time.
     */
    chrome.alarms.create('reaper', {
      'delayInMinutes': 10
    });

    setIcon(e.tabId);
  });
}, {url: [{hostEquals: 'code.google.com',
           pathPrefix: '/p/'},
          {hostEquals: 'thebugsof.googleplex.com'}]});

// Called when we need to update the iteration, or clean up old alarms.
chrome.alarms.onAlarm.addListener(function(alarm) {
  var tabId = alarmNameToTabId(alarm.name);
  if (isNaN(tabId)) {
    // This is the reaper alarm.  Reap alarms for dead tabs.
    chrome.alarms.getAll(function(alarms) {
      alarms.forEach(function(alarm) {
        var tabId = alarmNameToTabId(alarm.name);
        chrome.tabs.get(tabId, function(tab) {
          if (typeof(tab) == 'undefined') {
            console.log('OK to ignore previous error related to tab ' + tabId);
            chrome.alarms.clear(alarm.name);
          }
        });
      });
    });
    return;
  }

  /*
   * Make sure the tab still exists.  We do this since there is no event
   * we can listen to that'll allow us to unregister.  We cannot use the
   * chrome.tabs.onRemoved event as that'll end up waking up this page
   * on *every* tab closure.  Better to just let an alarm in the distant
   * future clean ourselves up.
   */
  chrome.tabs.get(tabId, function(tab) {
    if (typeof(tab) == 'undefined') {
      /*
       * We could use chrome.windows.getAll and walk all ids ourself, but
       * why bother when this is a lot less code and few people look at
       * the javascript console for errors.
       */
      console.log('OK to ignore previous error related to tab ' + tabId);
      chrome.alarms.clear(alarm.name);
    } else {
      updateIterData(function() { setIcon(tabId); });
    }
  });
});

/*
 * Iteration/time code.
 */

// If the network has not yet been synced, use this value.
// A current one can be found at:
const kCurrentIterUrl = 'http://chromepmo.appspot.com/schedule/iteration/json';
var iterState = {
  'start': (new Date('06 Jan 2014')).getTime(),
  'end': 0,
  'iteration': 97,
  'lastsync': 0,
};

// Fetch |url| and call |callback| with the response text.
function fetchUrl(url, callback) {
  var xhr = new XMLHttpRequest();
  try {
    xhr.onreadystatechange = function() {
      if (xhr.readyState != 4)
        return;

      if (xhr.responseText)
        callback(xhr.responseText);
    }

    xhr.open('GET', url, true);
    xhr.send(null);
  } catch (e) {
    console.error(url + '\nfetching failed', e);
  }
}

// Grab the current iteration details from the server.
function updateIterData(callback) {
  var url = kCurrentIterUrl;

  function readResponse(responseText) {
    var resp;
    try {
      resp = JSON.parse(responseText);
    } catch (e) {
      console.error(url + '\nparsing response failed\n' + responseText, e);
    }

    if ('start' in resp && 'end' in resp && 'iteration' in resp) {
      // The dates we get from the server are in UTC and align to midnight.
      // But the intention is not to have everyone in the world line up to
      // UTC.  From the Chrome PMO list:
      // ------------------------------------------------------------------
      // My guidance would be to ignore the timezone offset, it's more
      // important to have a relatively consistent timebox than it is to
      // stop work at an explicit time (i.e. I'd like a relatively normal
      // two weeks for everyone, it's more fair for the sake of measurement
      // and reporting, than to have cut offs that happen at odd points in
      // people's work days).
      // ------------------------------------------------------------------
      // So suck up the date and normalize it to the local timezone.
      function localizeUTCDate(utc_date) {
        var d = new Date(utc_date);
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
      iterState = {
        'start': localizeUTCDate(resp.start).getTime(),
        'end': localizeUTCDate(resp.end).getTime(),
        'iteration': resp.iteration,
        'lastsync': Date.now(),
      };
      // The response tells us the start of the last day of the iteration
      // rather than the time it ends.  e.g. We get back the date:
      //   Sun 19 Jan 2014 00:00:00
      // That means all of Sunday is part of this iteration.
      iterState.end += kMillisPerDay;
      storage.set(iterState);
      callback();
      return;
    } else {
      console.error(url + '\njson is incomplete\n', responseText);
    }
  }
  fetchUrl(url, readResponse);
}

// Make sure our iter data is synced from storage and up-to-date.
function syncIterState(callback) {
  if (callback === undefined)
    callback = function(){};

  var keys = ['start', 'end', 'iteration', 'lastsync'];
  storage.get(keys, function (items) {
    // Storage might not have all keys, so only sync what we get back.
    keys.forEach(function (key) {
      if (key in items)
        iterState[key] = items[key];
    });

    var now = Date.now();

    // Draw the icon fast using current data as it'll usually be right.
    if (now >= iterState.start && now < iterState.end)
      callback();

    // See if we need to fetch an update.  Do it at least once a day.
    if (iterState.end <= now ||
        iterState.lastsync + kMillisPerDay < now) {
      updateIterData(callback);
    }
  });
}

const kMillisPerDay = 1000 * 60 * 60 * 24;

function millisPerIter() {
  // Iterations usually last 2 weeks.
  return kMillisPerDay * 7 * 2;
}

function getIter() {
  var now = Date.now();
  // If our current data is viable, use it.  Else make a guess.
  if (now >= iterState.start && now < iterState.end)
    return iterState.iteration;
  else
    return Math.floor(iterState.iteration,
                      (now - iterState.start) / millisPerIter());
}

function millisToDateString(msecs) {
  return (new Date(msecs)).toDateString();
}

function iterSummary() {
  // This might return stale data, but it won't be wrong data.
  // Not a big deal as it should be rare that it's stale.
  return 'Chromium Iteration ' + iterState.iteration + '\n' +
         'First: ' + millisToDateString(iterState.start) + '\n' +
         'Last: ' + millisToDateString(iterState.end - kMillisPerDay) + '\n' +
         'Duration: ' + ((iterState.end - iterState.start) / kMillisPerDay) +
                    ' days';
}

/*
 * Drawing code.
 */

function setIcon(tabId) {
  updateCanvas();
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  chrome.pageAction.setIcon({'tabId':tabId, 'imageData':imageData});
  chrome.pageAction.setTitle({'tabId':tabId, 'title':iterSummary()});
  chrome.pageAction.show(tabId);
}

function drawCorner(ctx, cornerX, cornerY, endX, endY) {
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255, 255, 255, 255)';
  ctx.moveTo(cornerX, cornerY);
  ctx.lineTo(cornerX, endY);
  ctx.bezierCurveTo(cornerX, endY/3 + cornerY * 2 / 3, endX/3 + cornerX * 2 / 3,
                    cornerY, endX, cornerY);
  ctx.lineTo(cornerX, cornerY);
  ctx.fill();
}

function updateCanvas() {
  var canvas = document.getElementById('canvas');
  if (!canvas.getContext)
    return;
  var ctx = canvas.getContext('2d');

  var topSize = 0;
  ctx.fillStyle = 'rgba(0, 51, 0, 255)';
  ctx.fillRect(0, 0, canvas.width, topSize);
  // ctx.fillStyle = 'rgba(208, 208, 208, 0.8)';
  // var topSide = 3;
  // ctx.fillRect(topSide, 1, canvas.width - 2 * topSide, 1);

  ctx.fillStyle = '#008000';
  ctx.fillRect(0, topSize, canvas.width, canvas.height - topSize);

  ctx.font = 'bold 11pt Open Sans, sans-serif';
  ctx.fillStyle = 'rgb(255, 255, 255)';
  ctx.shadowColor = '#000000';
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetX = 1;
  ctx.shadowBlur = 1;
  var iter = getIter();
  var intIter = Math.floor(iter);
  var progress = iter - intIter;
  ctx.fillText('' + intIter, 2, canvas.height * .8);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgb(0, 192, 0)';
  ctx.fillRect(0, canvas.height - 2, canvas.width * progress, 2);
  var sz = 4;
  drawCorner(ctx, 0, 0, sz, sz);
  drawCorner(ctx, canvas.width, 0, canvas.width - sz, sz);
  drawCorner(ctx, 0, canvas.height, sz, canvas.height - sz);
  drawCorner(ctx, canvas.width, canvas.height, canvas.width - sz,
             canvas.height - sz);
}
