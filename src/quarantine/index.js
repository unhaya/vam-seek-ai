/**
 * Quarantine Module - ψ4.0 Information Quarantine
 *
 * De-semantification layer that prevents AI from accessing semantic meaning.
 * AI sees only physics queries (gradients, coordinates, RGB values).
 * Semantic reconstruction happens locally after AI response.
 *
 * 「画像を殺さず、質問を殺す」
 *
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

const { DeSemanticizer, PHYSICS_FEATURES, CONCEPT_MAP } = require('./DeSemanticizer');
const { QueryRouter } = require('./QueryRouter');

module.exports = {
  DeSemanticizer,
  QueryRouter,
  PHYSICS_FEATURES,
  CONCEPT_MAP
};
