// Copyright (c) 2013 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// AUTOGENERATED FILE
//
// This file is autogenerated! If you need to modify it, be sure to
// modify the script that exports patts voice data for use in Chrome.

// Initialize the voice array if it doesn't exist so that voice data files
// can be loaded in any order.

if (!window.voices) {
  window.voices = [];
}

// Add this voice to the global voice array.
window.voices.push({
  'projectFile': '/voice_data_hmm_ko-KR_2/project',
  'prefix': '',
  'method': 'hmm',
  'cacheToDisk': false,
  'lang': 'ko-KR',
  'gender': 'female',
  'removePaths': [],
  'files': [
    {
      'path': '/voice_data_hmm_ko-KR_2/compile_hmm_22050_ph_lsp_swop_ap_msd.cfg',
      'url': '',
      'md5sum': '1808a35af7480b64cff4f1b67e568275',
      'size': 9381,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/engine_hmm_22050_ap-embedded_lsp.cfg',
      'url': '',
      'md5sum': '020c3128e7d289c7a4f153178d1be5dd',
      'size': 4766,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/g2p_m3_syls0_stress0_ko-KR.fst',
      'url': '',
      'md5sum': '5a38ceff6286a10cf466c58b0abb518c',
      'size': 348426,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/hmm_voice_ko_kr_ism_medium_22050_ph_lsp_swop_ap_msd_bin_8bit.voice',
      'url': '',
      'md5sum': 'acb91286435151664870b81ac6d01086',
      'size': 273058,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/compressed_lexicon_ko_kr.blex',
      'url': '',
      'md5sum': '911714ab91b5a9d6c11548d9b1c4bc0d',
      'size': 3216144,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/textnorm_kestrel.cfg',
      'url': '',
      'md5sum': '97427f37e374112ac84c311c866c33b9',
      'size': 564,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/phonology.cfg',
      'url': '',
      'md5sum': '5b9ed16876228a45db854c269ac12c28',
      'size': 4861,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/phonology.pb',
      'url': '',
      'md5sum': '3bd999dce857d36aad8ecd7c387e2dc9',
      'size': 631,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/textnorm_params.pb',
      'url': '',
      'md5sum': 'b60f716d62724c28e98274cb123d93fc',
      'size': 16,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/tokenize_and_classify_android.far',
      'url': '',
      'md5sum': '81965d35a3b17333c639231ddca13d28',
      'size': 449341,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/verbalize_android.far',
      'url': '',
      'md5sum': '3ad7d3dbe5d65c235d3b1ee27bc74d50',
      'size': 761035,
    },
    {
      'path': '/voice_data_hmm_ko-KR_2/project',
      'url': '',
      'md5sum': '1ca0364666a74462bb11d5b867076b6c',
      'size': 1287,
    },
  ],
});
