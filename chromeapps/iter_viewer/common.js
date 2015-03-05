// Copyright 2014 The Chromium OS Authors. All rights reserved.
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

/*
 * Iteration/time code.
 */

// If the network has not yet been synced, use this value.
// A current one can be found at:
const kCurrentScheduleUrl = 'https://brillo-program.appspot.com/schedule';
var state = {
  'week': {
    'name': 'Week-1507',
    'start': (new Date('23 Feb 2015')).getTime(),
    'end': 0,
  },
  'phase': {
    'name': 'Phase-1',
    'start': (new Date('26 Feb 2015')).getTime(),
    'end': 0,
  },
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
function updateData(callback) {
  var url = kCurrentScheduleUrl;

  function readResponse(responseText) {
    var resp;
    try {
      resp = JSON.parse(responseText);
    } catch (e) {
      console.error(url + '\nparsing response failed\n' + responseText, e);
    }

    if ('iteration' in resp && 'phase' in resp) {
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
      state = {
        'week': {
          'start': localizeUTCDate(resp.iteration.start).getTime(),
          'end': localizeUTCDate(resp.iteration.end).getTime(),
          'name': resp.iteration.name,
        },
        'phase': {
          'start': localizeUTCDate(resp.phase.start).getTime(),
          'end': localizeUTCDate(resp.phase.end).getTime(),
          'name': resp.phase.name,
        },
        'lastsync': Date.now(),
      };
      // The response tells us the start of the last day of the iteration
      // rather than the time it ends.  e.g. We get back the date:
      //   Sun 19 Jan 2014 00:00:00
      // That means all of Sunday is part of this iteration.
      state.week.end += kMillisPerDay;
      state.phase.end += kMillisPerDay;
      storage.set(state);
      callback();
      return;
    } else {
      console.error(url + '\njson is incomplete\n', responseText);
    }
  }
  fetchUrl(url, readResponse);
}

// Make sure our iter data is synced from storage and up-to-date.
function syncState(callback) {
  if (callback === undefined)
    callback = function(){};

  // Clear out old keys from previous extension versions.
  var keys = ['start', 'end', 'iteration'];
  storage.remove(keys);

  // Load the current keys.
  var keys = ['week', 'phase', 'lastsync'];
  storage.get(keys, function (items) {
    // Storage might not have all keys, so only sync what we get back.
    keys.forEach(function (key) {
      if (key in items)
        state[key] = items[key];
    });

    var now = Date.now();

    // Draw the icon fast using current data as it'll usually be right.
    if (now >= state.week.start && now < state.week.end)
      callback();

    // See if we need to fetch an update.  Do it at least once a day.
    if (state.week.end <= now ||
        state.lastsync + kMillisPerDay < now) {
      updateData(callback);
    }
  });
}

const kMillisPerDay = 1000 * 60 * 60 * 24;

function millisPerIter() {
  // Iterations usually last 2 weeks.
  return kMillisPerDay * 7 * 2;
}

function getWeekInt() {
  var now = Date.now();
  // If our current data is viable, use it.  Else make a guess.
  var week = state.week.name.replace(/^Week-/, '');
  if (now >= state.week.start && now < state.week.end)
    return Math.floor(week);
  else
    return Math.floor(week, (now - state.week.start) / millisPerIter());
}

function millisToDateString(msecs) {
  return (new Date(msecs)).toDateString();
}

function stateSummary() {
  // This might return stale data, but it won't be wrong data.
  // Not a big deal as it should be rare that it's stale.
  //
  // We need to round the days in case of daylight transitions
  // where it might be +/- some hours.
  return 'Chromium ' + state.week.name + '\n' +
         'First: ' + millisToDateString(state.week.start) + '\n' +
         'Last: ' + millisToDateString(state.week.end - kMillisPerDay) + '\n' +
         'Duration: ' + Math.round((state.week.end - state.week.start) /
                                   kMillisPerDay) + ' days\n' +
         '\n' +
         'Chromium ' + state.phase.name + '\n' +
         'First: ' + millisToDateString(state.phase.start) + '\n' +
         'Last: ' + millisToDateString(state.phase.end - kMillisPerDay) + '\n' +
         'Duration: ' + Math.round((state.phase.end - state.phase.start) /
                                   kMillisPerDay) + ' days';
}

/*
 * Drawing code.
 */

function drawCorner(ctx, cornerX, cornerY, endX, endY) {
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255, 255, 255, 255)';
  ctx.moveTo(cornerX, cornerY);
  ctx.lineTo(cornerX, endY);
  ctx.bezierCurveTo(cornerX,
                    endY / 3 + cornerY * 2 / 3, endX / 3 + cornerX * 2 / 3,
                    cornerY, endX, cornerY);
  ctx.lineTo(cornerX, cornerY);
  ctx.fill();
}

// Pad out |num| with leading zeros to |digits|.
function pad(num, digits) {
  return ('0000' + num).slice(-digits);
}

function updateCanvas() {
  var canvas = document.getElementById('canvas');
  if (!canvas.getContext)
    return;
  var ctx = canvas.getContext('2d');

  // Fill the background.  Use a slightly less-than-white color so that the
  // text is guaranteed to stand out.
  ctx.fillStyle = '#eeeeee';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Give the text a slight shadow/blur to make it more readable.
  ctx.shadowColor = '#ffffff';
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetX = 1;
  ctx.shadowBlur = 1;

  // Write out the text in black.  This lets us use the space around the icon
  // to give us more contrast and make the text larger.
  ctx.font = 'bold 10pt Open Sans, sans-serif';
  ctx.fillStyle = '#000000';
  // Since the # is going to be 4 digits, split it into two and stack on top
  // of each other.  This lets us use a larger text.
  var intWeek = getWeekInt();
  var intTop = Math.floor(intWeek / 100);
  var intBottom = intWeek % 100;
  ctx.fillText('' + intTop, 1, canvas.height / 2 - 1);
  ctx.fillText(pad(intBottom, 2), 2, canvas.height - 0);

  // Give the icon some rounded corners.
  var sz = 4;
  drawCorner(ctx, 0, 0, sz, sz);
  drawCorner(ctx, canvas.width, 0, canvas.width - sz, sz);
  drawCorner(ctx, 0, canvas.height, sz, canvas.height - sz);
  drawCorner(ctx, canvas.width, canvas.height, canvas.width - sz,
             canvas.height - sz);
}
