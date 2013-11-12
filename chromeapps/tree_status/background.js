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
    'throttled':   '#FFFC6C'
};
const pollIntervalMin = 1000 * 60;  // 1 minute
const pollIntervalMax = 1000 * 60 * 60;  // 1 hour
var requestFailureCount = 0;  // used for exponential backoff
const requestTimeout = 1000 * 2;  // 5 seconds
var rotation = 0;
var loadingAnimation = null;
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
  startRequest();
}

chrome.alarms.onAlarm.addListener(function(alarm) {
  log('alarm ' + alarm.name + ' fired');
  startRequest();
});

function scheduleRequest() {
  var exponent = Math.pow(2, requestFailureCount);
  // Make sure we keep this to a min.  If Math.random() returns a small
  // enough value, it might end up rescheduling immediately.
  var delay = Math.min(pollIntervalMin + (Math.random() * pollIntervalMin * exponent),
                       pollIntervalMax);
  delay = Math.round(delay);

  log('scheduled next refresh ' + delay / 1000.0 + ' secs from now');
  chrome.alarms.create('tree poller', {
    'when': Date.now() + delay
  });
}

// ajax stuff
function startRequest() {
  if (loadingAnimation)
    loadingAnimation.start();

  getTreeState(
    function(tstatus, message) {
      if (loadingAnimation)
        loadingAnimation.stop();
      updateTreeStatus(tstatus, message);
      scheduleRequest();
    },
    function() {
      if (loadingAnimation)
        loadingAnimation.stop();
      showTreeStatus();
      scheduleRequest();
    }
  );
}

function getTreeState(onSuccess, onError) {
  var xhr = new XMLHttpRequest();
  var abortTimerId = window.setTimeout(function() {
    xhr.abort();  // synchronously calls onreadystatechange
  }, requestTimeout);

  function handleSuccess(status, message) {
    requestFailureCount = 0;
    window.clearTimeout(abortTimerId);
    if (onSuccess)
      onSuccess(status, message);
  }

  function handleError() {
    ++requestFailureCount;
    window.clearTimeout(abortTimerId);
    if (onError)
      onError();
  }

  try {
    xhr.onreadystatechange = function(){
      if (xhr.readyState != 4)
        return;

      if (xhr.responseText) {
        var resp;
        try {
          resp = JSON.parse(xhr.responseText);
        } catch(ex) {
          handleError();
        }

        if (resp.general_state != null && resp.general_state != "") {
          handleSuccess(resp.general_state, resp.message);
          return;
        } else {
          console.error(chrome.i18n.getMessage("chromebuildlcheck_node_error"));
        }
      }

      handleError();
    }

    xhr.onerror = function(error) {
      handleError();
    }

    xhr.open("GET", getStatusUrl(), true);
    xhr.send(null);
  } catch(e) {
    console.error(chrome.i18n.getMessage("chromebuildcheck_exception", e));
    handleError();
  }
}


function updateTreeStatus(tstatus, message) {
  chrome.browserAction.setTitle({ 'title': message });
  /* chrome.browserAction.setBadgeText({text: message}); */
  if (localStorage.treeStatus != tstatus) {
    localStorage.treeStatus = tstatus;
    animateFlip();
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
  if (status in color_index) {
    chrome.browserAction.setBadgeBackgroundColor({color: color_index[status]});
  } else {
    status = 'unknown';
    localStorage.treeStatus = '';
    chrome.browserAction.setBadgeBackgroundColor({color:[190, 190, 190, 230]});
    chrome.browserAction.setTitle({ 'title': "Tree status is unknown" });
  }
  // We need to set the final icon back to an external file.  This way when the
  // background page is automatically destroyed, the icon doesn't get blanked.
  chrome.browserAction.setIcon({path: 'tree_is_' + status + '.png'});
}

function drawIconAtRotation() {
  var key = localStorage.treeStatus;
  if (!(key in color_index))
    key = 'unknown';
  if (!(key in image_cache)) {
    var img = image_cache[key] = new Image();
    img.src = 'tree_is_' + key + '.png';
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

function goToWaterfall() {
  var wurl = waterfallUrl();

  if (localStorage.onClickBehavior != "reuse") {
    chrome.tabs.create({url: wurl});
    return;
  }

  chrome.tabs.getAllInWindow(undefined, function(tabs) {
    for (var i = 0, tab; tab = tabs[i]; i++) {
      if (tab.url && tab.url == wurl) {
        chrome.tabs.update(tab.id, {url: tab.url, selected: true}, null);
        return;
      }
    }
    chrome.tabs.create({url: wurl});
  });
}

// Called when the user clicks on the browser action.
chrome.browserAction.onClicked.addListener(function(tab) {
  goToWaterfall();
  startRequest();
});
