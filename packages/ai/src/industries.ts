/**
 * Industry packs live in @awning/spec so the template builder can use the same palettes
 * and section orders the model is shown. Two copies would drift, and the drift would be
 * invisible: generated sites and template sites would quietly stop looking related.
 */
export { INDUSTRY_PACKS, DEFAULT_PACK, packFor, type IndustryPack } from '@awning/spec'
