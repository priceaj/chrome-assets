// Copyright (c) 2013 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var default_status_url = 'https://chromiumos-status.appspot.com/current';
var default_waterfall_url = 'https://build.chromium.org/p/chromiumos/waterfall';

// Normalize the full URL to the base which is what chrome.permissions expects.
// e.g. The form http://foo/current becomes http://foo/*
function originsUrl(url) {
  return url.split(/\//).slice(0, 3).join('/') + '/*';
}
