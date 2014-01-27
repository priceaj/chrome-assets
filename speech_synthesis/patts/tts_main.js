// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Event listener for the Google text-to-speech extension.
 *
 * This class implements the Chrome TTS engine extnesion API and dispatches
 * speech requests to one or more instances of TtsController, defined in
 * tts_controller.js.
 *
 * Multiple instances are used so that the HMM voice can load immediately
 * while the Unit Selection voice is loading in the background. Typically
 * the HMM data is local while the Unit Selection data may need to be
 * downloaded from a remote server.
 */

'use strict';

var TtsMain = function() {
  this.callback = null;
  this.utteranceId = 0;
  this.voice = null;
  this.lang = '';
  this.voiceName = '';
  this.pendingSpeechRequest = null;
};

TtsMain.prototype.run = function() {
  document.addEventListener('unload', this.unload, false);
  this.getVoiceNamesFromManifest(function() {
    this.loadControllers();
    chrome.ttsEngine.onSpeak.addListener(this.onSpeak.bind(this));
    chrome.ttsEngine.onStop.addListener(this.onStop.bind(this));
  });
};

TtsMain.prototype.getVoiceNamesFromManifest = function(completion) {
  var self = this;
  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    var manifest = JSON.parse(this.responseText);
    var manifestVoices = manifest.tts_engine.voices;
    var langGenderMap = {};
    for (var i = 0; i < manifestVoices.length; i++) {
      langGenderMap[manifestVoices[i].lang + '-' + manifestVoices[i].gender] =
          manifestVoices[i].voice_name;
    }
    for (var i = 0; i < window.voices.length; i++) {
      window.voices[i].voiceName =
          langGenderMap[window.voices[i].lang + '-' + window.voices[i].gender];
    }
    (completion.bind(self))();
  };
  xhr.open('get', chrome.extension.getURL('manifest.json'), true);
  xhr.send();
};

TtsMain.prototype.loadControllers = function() {
  this.hmmController = new TtsController('hmm', this);
//  this.uselController = new TtsController('usel', this);
};

/**
 * Called by one of the TTS controllers.
 */
TtsMain.prototype.onInitialized = function() {
  this.speakPendingRequest();
};

/**
 * Called by one of the TTS controllers.
 */
TtsMain.prototype.onResponse = function(utteranceId, response) {
  if (utteranceId != this.utteranceId || this.callback == null) {
    return;
  }

  console.log('onResponse type=' + response.type + ' utteranceId=' + utteranceId);

  this.callback(response);
  var type = response.type;
  if (type == 'end' || type == 'interrupted' ||
      type == 'cancelled' || type == 'error') {
    this.callback = null;
  }
};

TtsMain.prototype.onStop = function() {
  this.pendingSpeechRequest = null;
  this.callback = null;
  this.hmmController.onStop();
//  this.uselController.onStop();
};

TtsMain.prototype.onSpeak = function(utterance, options, callback) {
  console.log('Will speak: "' + utterance + '" lang="' + options.lang + '"');

  this.hmmController.switchVoiceIfNeeded(
      options.voiceName, options.lang, options.gender);
//  this.uselController.switchVoiceIfNeeded(
//      options.voiceName, options.lang, options.gender);

  if (!this.hmmController.initialized) { //  && !this.uselController.initialized) {
    console.log('Nothing is initialized yet.');
    if (this.pendingSpeechRequest) {
      var response = {type: 'cancelled', charIndex: 0};
      var pendingCallback = this.pendingSpeechRequest[2];
      pendingCallback(response);
      this.pendingSpeechRequest = null;
    }

    this.pendingSpeechRequest = [utterance, options, callback];
    return;
  }

  this.hmmController.onStop();
//  this.uselController.onStop();

  this.utteranceId++;
  this.callback = callback;
  console.log('SETTING CALLBACK, id=' + this.utteranceId);

//  if (this.uselController.initialized) {
//    console.log('Using unit selection');
//    this.currentController = this.uselController;
//  } else {
    console.log('Using HMM');
    this.currentController = this.hmmController;      
//  }

  this.currentController.onSpeak(utterance, options, this.utteranceId);
};

TtsMain.prototype.speakPendingRequest = function() {
  if (!this.pendingSpeechRequest)
    return;

  var utterance = this.pendingSpeechRequest[0];
  var options = this.pendingSpeechRequest[1];
  var callback = this.pendingSpeechRequest[2];
  this.pendingSpeechRequest = null;
  this.onSpeak(utterance, options, callback);
};

TtsMain.prototype.unload = function() {
  this.hmmController.unload();
//  this.uselController.unload();
};

var ttsController = new TtsMain();
ttsController.run();
