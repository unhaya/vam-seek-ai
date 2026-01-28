/**
 * StandardProcessor - Default Grid Processor
 *
 * VAM-RGB Plugin Architecture v1.0
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * Standard frame capture without temporal encoding.
 * Maintains V7.29 behavior.
 */

class StandardProcessor extends BaseGridProcessor {
  constructor(video, config = {}) {
    super(video, config);
  }

  get name() {
    return 'Standard';
  }

  async captureFrame(timestamp) {
    return await this._captureRawFrame(timestamp);
  }
}

window.StandardProcessor = StandardProcessor;
