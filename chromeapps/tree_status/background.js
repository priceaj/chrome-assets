// Copyright (c) 2013 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var animationFrames = 36;
var animationSpeed = 10; // ms
var canvas;
var canvasContext;
var image_cache = {};
var color_index = {
    // This is kept in sync with the status site.
    // http://src.chromium.org/viewvc/chrome/trunk/tools/chromium-status/stylesheets/style.css
    // Also make sure that there is a corresponding tree_is_xxx.png icon.
    'closed':      '#E98080',
    'maintenance': '#FF80FF',
    'open':        '#8FDF5F',
    'throttled':   '#FFFC6C',
};
// Schedule sheriff updates every hour to deal with timezone shifts.
const pollSheriff = 1000 * 60 * 60;  // 1 hour
const pollIntervalMin = 1000 * 60;  // 1 minute
const pollIntervalMax = 1000 * 60 * 60;  // 1 hour
var requestFailureCount = 0;  // used for exponential backoff
const requestTimeout = 1000 * 2;  // 5 seconds
var rotation = 0;
var loadingAnimation = null;
var isSheriff = false;
// Debug code
// loadingAnimation = new LoadingAnimation();

function log(msg, obj) {
  console.log(new Date() + '\n' + msg, obj);
}

function getStatusUrl() {
  var url = default_status_url;
  if (localStorage.customStatus)
    url = localStorage.customStatus;
  return url + "?format=json";
}

function getSheriffUrl(sheriff) {
  var url = waterfallUrl();
  // Chop the "/waterfall" part off.
  url = url.substr(0, url.lastIndexOf('/'));
  return url + "/" + sheriff + ".js";
}

function waterfallUrl() {
  var url = default_waterfall_url;
  if (localStorage.customWaterfall)
    url = localStorage.customWaterfall;
  return url;
}

// A "loading" animation displayed while we wait for the first response.
// This animates the badge text with a dot that cycles from left to right.
function LoadingAnimation() {
  this.timerId_ = 0;
  this.maxCount_ = 8;  // Total number of states in animation
  this.current_ = 0;  // Current state
  this.maxDot_ = 4;  // Max number of dots in animation
}

LoadingAnimation.prototype.paintFrame = function() {
  var text = "";
  for (var i = 0; i < this.maxDot_; i++) {
    text += (i == this.current_) ? "." : " ";
  }
  if (this.current_ >= this.maxDot_)
    text += "";

  this.current_++;
  if (this.current_ == this.maxCount_)
    this.current_ = 0;

  chrome.browserAction.setBadgeText({ text: text });
}

LoadingAnimation.prototype.start = function() {
  if (this.timerId_)
    return;

  var self = this;
  this.timerId_ = window.setInterval(function() {
    self.paintFrame();
  }, 100);
}

LoadingAnimation.prototype.stop = function() {
  if (!this.timerId_)
    return;

  window.clearInterval(this.timerId_);
  this.timerId_ = 0;

  chrome.browserAction.setBadgeText({ text: '' });
}

window.onload = function() {
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = 19;
  canvasContext = canvas.getContext('2d');

  showTreeStatus(localStorage.treeStatus);
  chrome.notifications.onClicked.addListener(goToStatusPage);
  startRequests();
}

chrome.alarms.onAlarm.addListener(function(alarm) {
  log('alarm ' + alarm.name + ' fired');
  if (alarm.name == 'tree poller')
    startTreeRequest();
  else if (alarm.name == 'sheriff poller')
    startSheriffRequest();
});

function schedule(type, delay) {
  log('scheduled next ' + type + 'refresh ' + delay / 1000.0 + ' secs from now');
  chrome.alarms.create(type + ' poller', {
    'when': Date.now() + delay
  });
}

function scheduleTreeRequest() {
  var exponent = Math.pow(2, requestFailureCount);
  // Make sure we keep this to a min.  If Math.random() returns a small
  // enough value, it might end up rescheduling immediately.
  var delay = Math.min(pollIntervalMin + (Math.random() * pollIntervalMin * exponent),
                       pollIntervalMax);
  delay = Math.round(delay);
  schedule('tree', delay);
}

function scheduleSheriffRequest() {
  schedule('sheriff', pollSheriff);
}

// ajax stuff
function startRequests() {
  startTreeRequest();
  startSheriffRequest();
}

function startTreeRequest() {
  if (loadingAnimation)
    loadingAnimation.start();

  getTreeState(
    function(tstatus, message) {
      if (loadingAnimation)
        loadingAnimation.stop();
      updateTreeStatus(tstatus, message);
      scheduleTreeRequest();
    },
    function() {
      if (loadingAnimation)
        loadingAnimation.stop();

      // If we failed, maybe it was because we lack permission.  Check it,
      // and if that's the case, pop open the options page.  It'll show a
      // status message telling the user to approve.
      var origins_url = originsUrl(getStatusUrl());
      chrome.permissions.contains({
        origins: [origins_url]
      }, function(granted) {
        if (granted) {
          showTreeStatus();
          scheduleTreeRequest();
        } else {
          // Work around http://crbug.com/125706.
          chrome.permissions.request({
            origins: [origins_url]
          }, function(granted) {
            if (!granted && !chrome.runtime.lastError) {
              goToUrl(chrome.extension.getURL('options.html'));
            }
          });
        }
      });
    }
  );
}

function showSheriffs(enabled) {
  isSheriff = enabled;
  if (isSheriff) {
    chrome.browserAction.setBadgeText({text: '«Ф»'});
    chrome.browserAction.setBadgeBackgroundColor({color: '#ffc600'});
  } else {
    chrome.browserAction.setBadgeText({text: ''});
  }
}

function startSheriffRequest() {
  if (!localStorage.username) {
    chrome.browserAction.setBadgeText({text: '?!?'});
    chrome.browserAction.setBadgeBackgroundColor({color: '#000000'});
    return;
  }
  getSheriffs(
    function(sheriffs) {
      showSheriffs(sheriffs.indexOf(localStorage.username) != -1);
    }
  );
}

function getUrl(url, onSuccess, onError) {
  var xhr = new XMLHttpRequest();
  var abortTimerId = window.setTimeout(function() {
    xhr.abort();  // synchronously calls onreadystatechange
  }, requestTimeout);

  function handleSuccess(response) {
    requestFailureCount = 0;
    window.clearTimeout(abortTimerId);
    if (onSuccess)
      onSuccess(response);
  }

  function handleError() {
    ++requestFailureCount;
    window.clearTimeout(abortTimerId);
    if (onError)
      onError();
  }

  try {
    xhr.onreadystatechange = function() {
      if (xhr.readyState != 4)
        return;

      if (xhr.responseText)
        handleSuccess(xhr.responseText);
      else
        handleError();
    }

    xhr.onerror = function(error) {
      handleError();
    }

    xhr.open("GET", url, true);
    xhr.send(null);
  } catch (e) {
    console.error(chrome.i18n.getMessage("chromebuildcheck_exception", e));
    handleError();
  }
}

function getTreeState(onSuccess, onError) {
  function parseResponse(response) {
    var resp;
    try {
      resp = JSON.parse(response);
    } catch (ex) {
      onError();
    }

    if (resp.general_state != null && resp.general_state != "") {
      if (onSuccess)
        onSuccess(resp.general_state, resp.message);
    } else
      console.error(chrome.i18n.getMessage("chromebuildlcheck_node_error"));
  }
  getUrl(getStatusUrl(), parseResponse, onError);
}

function getSheriffs(onSuccess, onError) {
  function checkSheriffs(onSuccess) {
    var sheriffs = localStorage._sheriffs + "," + localStorage._sheriffs2;
    if (onSuccess)
      onSuccess(sheriffs.split(/ *, */));
  }
  function parseResponse(response) {
    // Example content:
    // document.write('avakulenko, davidriley')
    var sheriffs = response.replace(/^[^(]*[(]'(.*)'[)]/, '$1');
    log('found sheriffs', sheriffs);
    return sheriffs;
  }

  function parseResponseSheriff(response) {
    localStorage._sheriffs = parseResponse(response);
    checkSheriffs(onSuccess);
  }
  getUrl(getSheriffUrl('sheriff'), parseResponseSheriff, onError);

  function parseResponseSheriff2(response) {
    localStorage._sheriffs2 = parseResponse(response);
    checkSheriffs(onSuccess);
  }
  getUrl(getSheriffUrl('sheriff2'), parseResponseSheriff2, onError);
}

function notifyChange(status, message) {
  var image_path = 'images/tree_is_' + status + '_128x128.png';
  var options = {
    type: 'basic',
    title: 'Tree is now ' + status + '!',
    message: message,
    iconUrl: chrome.extension.getURL(image_path),
    priority: 0,
    isClickable: true,
  };
  chrome.notifications.clear('chrome waterfall', function(wasCleared) {
    chrome.notifications.create('chrome waterfall', options, function(){});
  });
}

function updateTreeStatus(tstatus, message) {
  if (!localStorage.username)
    message += '\n\nPlease set your username in the options page!';
  chrome.browserAction.setTitle({'title': message});
  /* chrome.browserAction.setBadgeText({text: message}); */
  if (localStorage.treeStatus != tstatus) {
    localStorage.treeStatus = tstatus;
    animateFlip();
    if (isSheriff && localStorage.notifyBehavior != "none")
      notifyChange(tstatus, message);
  }
}


function ease(x) {
  return (1-Math.sin(Math.PI/2+x*Math.PI))/2;
}

function animateFlip() {
  rotation += 1/animationFrames;
  drawIconAtRotation();

  if (rotation <= 1) {
    setTimeout(animateFlip, animationSpeed);
  } else {
    rotation = 0;
    drawIconAtRotation();
    showTreeStatus(localStorage.treeStatus);
  }
}

function showTreeStatus(status) {
  log('setting status to', status);
  if (!(status in color_index)) {
    status = 'unknown';
    localStorage.treeStatus = '';
    chrome.browserAction.setTitle({ 'title': "Tree status is unknown" });
  }
  // We need to set the final icon back to an external file.  This way when the
  // background page is automatically destroyed, the icon doesn't get blanked.
  chrome.browserAction.setIcon({path: 'images/tree_is_' + status + '.png'});
}

function drawIconAtRotation() {
  var key = localStorage.treeStatus;
  if (!(key in color_index))
    key = 'unknown';
  if (!(key in image_cache)) {
    var img = image_cache[key] = new Image();
    img.src = 'images/tree_is_' + key + '.png';
  }

  canvasContext.save();
  canvasContext.clearRect(0, 0, canvas.width, canvas.height);
  canvasContext.translate(
      Math.ceil(canvas.width/2),
      Math.ceil(canvas.height/2));
  canvasContext.rotate(2*Math.PI*ease(rotation));
  canvasContext.drawImage(image_cache[key],
      -Math.ceil(canvas.width/2),
      -Math.ceil(canvas.height/2));
  canvasContext.restore();

  chrome.browserAction.setIcon({imageData:canvasContext.getImageData(0, 0,
      canvas.width,canvas.height)});
}

function goToNewUrl(url) {
  chrome.tabs.getAllInWindow(undefined, function(tabs) {
    for (var i = 0, tab; tab = tabs[i]; i++) {
      if (tab.url && tab.url == url) {
        chrome.tabs.update(tab.id, {url: tab.url, selected: true}, null);
        return;
      }
    }
    chrome.tabs.create({url: url});
  });
}

function goToUrl(url) {
  if (localStorage.onClickBehavior != "reuse") {
    chrome.tabs.create({url: url});
    return;
  }

  goToNewUrl(url);
}

function goToWaterfall() {
  goToUrl(waterfallUrl());
}

function goToStatusPage() {
  var url = getStatusUrl();
  url = url.substr(0, url.lastIndexOf('/'));
  goToUrl(url);
}

// Called when the user clicks on the browser action.
chrome.browserAction.onClicked.addListener(function(tab) {
  goToWaterfall();
  startRequests();
});
