// Copyright (c) 2013 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var customStatusTextbox;
var customWaterfallTextbox;
var onClickBehaviorCheckbox;
var statusText;
var saveButton;
var cancelButton;

window.onload = function() {
  customStatusTextbox = document.getElementById("custom-status");
  customWaterfallTextbox = document.getElementById("custom-waterfall");
  onClickBehaviorCheckbox = document.getElementById("onclick-behavior");
  statusText = document.getElementById("status");
  saveButton = document.getElementById("save-button");
  cancelButton = document.getElementById("cancel-button");

  customStatusTextbox.oninput = markDirty;
  customWaterfallTextbox.oninput = markDirty;
  onClickBehaviorCheckbox.onclick = markDirty;
  saveButton.onclick = save;
  cancelButton.onclick = init;

  init();
};

function init() {
  customStatusTextbox.placeholder = default_status_url;
  customStatusTextbox.value = localStorage.customStatus || "";
  customWaterfallTextbox.placeholder = default_waterfall_url;
  customWaterfallTextbox.value = localStorage.customWaterfall || "";
  onClickBehaviorCheckbox.checked = localStorage.onClickBehavior != "reuse";

  var origins_url = originsUrl(localStorage.customStatus || default_status_url);
  chrome.permissions.contains({
    origins: [origins_url]
  }, function(granted) {
    if (granted)
      markClean();
    else
      setStatus('Please hit the save button to grant permission to the ' +
                'waterfalls', 0);
  });
}

function setStatus(status, timeout) {
  statusText.innerText = status;
  statusText.hidden = false;

  if (timeout === undefined)
    timeout = 5000;

  if (timeout)
    statusText.timeout = setTimeout(function() {
      statusText.hidden = true;
    }, timeout);
}

function save() {
  localStorage.customWaterfall = customWaterfallTextbox.value;
  localStorage.onClickBehavior =
    onClickBehaviorCheckbox.checked ? "newtab" : "reuse";

  var status_url = customStatusTextbox.value || default_status_url;
  var perm_url = originsUrl(status_url);
  console.log('normalizing "' + status_url + '" to "' + perm_url + '"');

  chrome.permissions.request({
    origins: [perm_url]
  }, function(granted) {
    if (granted) {
      // First revoke existing perms that the user gave us.
      chrome.permissions.getAll(function(perms) {
        perms.origins.forEach(function(key) {
          if (key == perm_url)
            return;

          console.log('revoking access to', key);
          chrome.permissions.remove({
            origins: [key],
          });
        });
      });

      // Then save the settings for the new URL.
      localStorage.customStatus = customStatusTextbox.value;
      setStatus('Saved!');
      markClean();

      // Trigger an update.
      chrome.extension.getBackgroundPage().startRequest();
    } else {
      if (status_url.substr(0, 7) != 'http://' ||
          status_url.substr(0, 8) != 'https://')
        setStatus('Status must be a valid http:// or https:// URL!');
      else
        setStatus('You must grant permission in order to save!');
    }
  });
}

function markDirty() {
  saveButton.disabled = false;
}

function markClean() {
  saveButton.disabled = true;
}
