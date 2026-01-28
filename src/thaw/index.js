/**
 * Thaw Decoder Module - VAM-RGB Temporal Reconstruction
 *
 * Exports all Thaw components for Node.js usage.
 * Browser usage: each file self-registers on window.
 */

'use strict';

const ChannelSeparator = require('./ChannelSeparator');
const ColorEstimator = require('./ColorEstimator');
const ReconstructionValidator = require('./ReconstructionValidator');
const ThawDecoder = require('./ThawDecoder');

module.exports = {
  ChannelSeparator,
  ColorEstimator,
  ReconstructionValidator,
  ThawDecoder
};
