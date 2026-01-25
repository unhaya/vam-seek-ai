/**
 * Grid Processor Plugin Loader
 *
 * VAM-RGB Plugin Architecture v1.9
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * Registry and factory for grid processor plugins.
 * Includes prompt plugin support for AI interpretation.
 * v1.8a adds Universal Translator for Video Gen AI platforms.
 * v1.8c adds Secondary Chaos Prediction.
 * v1.9 adds Encoder (Video → VAM-RGB Image).
 */

const GridProcessorPlugin = (function() {
  // Debug: Check if processors are defined
  console.log('[GridProcessor] Init check - StandardProcessor:', typeof window.StandardProcessor);
  console.log('[GridProcessor] Init check - VAMRGBProcessor:', typeof window.VAMRGBProcessor);

  // Processor registry
  const processors = {
    'standard': window.StandardProcessor,
    'vam-rgb': window.VAMRGBProcessor
  };

  // Prompt registry (maps processor name to prompt plugin)
  // Note: vam-rgb-decoder is for Video Gen AI output, not user chat
  const prompts = {
    'standard': window.StandardPrompt,
    'vam-rgb': window.VAMRGBPrompt,
    'vam-rgb-decoder': window.VAMRGBDecoder,
    'vam-rgb-translator': window.VAMRGBTranslator,
    'vam-rgb-chaos': window.VAMRGBChaos,
    'vam-rgb-encoder': window.VAMRGBEncoder
  };

  function getProcessor(type, video, config = {}) {
    const ProcessorClass = processors[type];
    if (!ProcessorClass) {
      console.warn(`[GridProcessor] Unknown processor: ${type}, falling back to standard`);
      return new window.StandardProcessor(video, config);
    }
    return new ProcessorClass(video, config);
  }

  function getPrompt(type) {
    const prompt = prompts[type];
    if (!prompt) {
      console.warn(`[GridProcessor] Unknown prompt: ${type}, falling back to standard`);
      return prompts['standard'];
    }
    return prompt;
  }

  function getSystemPrompt(type) {
    const prompt = getPrompt(type);
    if (prompt && typeof prompt.getSystemPrompt === 'function') {
      return prompt.getSystemPrompt();
    }
    return '';
  }

  function registerProcessor(name, ProcessorClass) {
    processors[name] = ProcessorClass;
    console.log(`[GridProcessor] Registered processor: ${name}`);
  }

  function registerPrompt(name, PromptPlugin) {
    prompts[name] = PromptPlugin;
    console.log(`[GridProcessor] Registered prompt: ${name}`);
  }

  function listProcessors() {
    return Object.keys(processors);
  }

  function listPrompts() {
    return Object.keys(prompts);
  }

  /**
   * Get the Universal Translator for Video Gen AI platforms
   * @returns {Object} VAMRGBTranslator instance
   */
  function getTranslator() {
    return window.VAMRGBTranslator;
  }

  /**
   * Translate a VAM-RGB anchor to platform-specific format
   * @param {Object} anchor - VAM-RGB JSON Anchor
   * @param {string} platform - Target platform ('runway' | 'luma' | 'kling')
   * @param {Object} options - Platform-specific options
   * @returns {Object} Platform-specific output
   */
  function translateAnchor(anchor, platform, options = {}) {
    const translator = getTranslator();
    if (!translator) {
      throw new Error('[GridProcessor] Translator not loaded');
    }
    return translator.translate(anchor, platform, options);
  }

  /**
   * Get the Chaos Prediction Engine
   * @returns {Object} VAMRGBChaos instance
   */
  function getChaosEngine() {
    return window.VAMRGBChaos;
  }

  /**
   * Predict secondary chaos effects from a VAM-RGB anchor
   * @param {Object} anchor - VAM-RGB JSON Anchor with mass_momentum
   * @returns {Object} Chaos predictions
   */
  function predictChaos(anchor) {
    const chaos = getChaosEngine();
    if (!chaos) {
      throw new Error('[GridProcessor] Chaos engine not loaded');
    }
    return chaos.predictFromAnchor(anchor);
  }

  /**
   * Get the VAM-RGB Encoder
   * @returns {Object} VAMRGBEncoder instance
   */
  function getEncoder() {
    return window.VAMRGBEncoder;
  }

  /**
   * Encode video frames to VAM-RGB image
   * @param {ImageData[]} frames - Array of 7+ frames as ImageData
   * @param {Object} options - Encoding options
   * @returns {ImageData} VAM-RGB encoded image
   */
  function encodeFrames(frames, options = {}) {
    const encoder = getEncoder();
    if (!encoder) {
      throw new Error('[GridProcessor] Encoder not loaded');
    }
    return encoder.encodeFromFrames(frames, options);
  }

  return {
    getProcessor,
    getPrompt,
    getSystemPrompt,
    registerProcessor,
    registerPrompt,
    listProcessors,
    listPrompts,
    getTranslator,
    translateAnchor,
    getChaosEngine,
    predictChaos,
    getEncoder,
    encodeFrames
  };
})();

window.GridProcessorPlugin = GridProcessorPlugin;
console.log('[GridProcessor] Plugin system loaded.');
console.log('[GridProcessor] Processors:', GridProcessorPlugin.listProcessors());
console.log('[GridProcessor] Prompts:', GridProcessorPlugin.listPrompts());
