import appHtml from '../../mcp-app-ui/dist/cardz-app.html';
import landingHtml from './landing.html';
import publicCopy from '../../../docs/legal/public-copy.md';
import logoSvg from '../../../assets/brand/logo.svg';
import iconPng from '../../../assets/brand/icon.png';
import landingPreviewPng from '../../../assets/brand/landing-preview.png';
import { handleRequest } from './worker.mjs';

const assets = { appHtml, landingHtml, publicCopy, logoSvg, iconPng, landingPreviewPng };

export default {
  fetch: (request, env, ctx) => handleRequest(request, env, ctx, { assets }),
};
