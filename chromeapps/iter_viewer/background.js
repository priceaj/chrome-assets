// Copyright 2014 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// When visiting a tracker page, show the icon.
chrome.webNavigation.onCommitted.addListener(function(e) {
  syncState(function() {
    // Set an alarm to update icon when the next change occurs.
    chrome.alarms.create(tabIdToAlarmName(e.tabId), {
      'when': Math.min(state.week.end, state.phase.end),
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
      updateData(function() { setIcon(tabId); });
    }
  });
});

// Update the page action icon.
function setIcon(tabId) {
  updateCanvas();
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  chrome.pageAction.setIcon({'tabId':tabId, 'imageData':imageData});
  chrome.pageAction.setTitle({'tabId':tabId, 'title':stateSummary()});
  chrome.pageAction.show(tabId);
  chrome.pageAction.setPopup({'tabId':tabId, 'popup':'popup.html'});
}
