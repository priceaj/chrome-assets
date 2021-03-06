// Copyright (c) 2013 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// AUTOGENERATED FILE
//
// This file is autogenerated! If you need to modify it, be sure to
// modify the script that exports Google voice data for use in Chrome.

// Initialize the voice array if it doesn't exist so that voice data files
// can be loaded in any order.

if (!window.voices) {
  window.voices = [];
}

// Add this voice to the global voice array.
window.voices.push({
  'pipelineFile': '/voice_lstm_nl-NL/lstm/pipeline',
  'prefix': '',
  'voiceType': 'lstm',
  'cacheToDisk': false,
  'lang': 'nl-NL',
  'gender': 'female',
  'removePaths': [],
  'files': [
    {
      'path': '/voice_lstm_nl-NL.zvoice',
      'url': '',
      'md5sum': '8683624c073cbbdcfb5f1512381e3054',
      'size': 7497253,
    },
  ],
});
