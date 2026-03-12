#!/usr/bin/env node

/**
 * CHIMERA CLI — Cross-Provider Intelligence
 */

import { Chimera, Strategy } from '../lib/unified-api.mjs';

// ── Banner ─────────────────────────────────────────────────
const ROSE = '\x1b[38;2;244;63;94m';
const TEAL = '\x1b[38;2;20;184;166m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const R = '\x1b[0m';
const WHITE = '\x1b[97m';
const BG_DARK = '\x1b[48;2;15;15;20m';

function printBanner() {
  console.log(`
${BG_DARK}${ROSE}${BOLD}
    ██████╗██╗  ██╗██╗███╗   ███╗███████╗██████╗  █████╗
   ██╔════╝██║  ██║██║████╗ ████║██╔════╝██╔══██╗██╔══██╗
   ██║     ███████║██║██╔████╔██║█████╗  ██████╔╝███████║
   ██║     ██╔══██║██║██║╚██╔╝██║██╔══╝  ██╔══██╗██╔══██║
   ╚██████╗██║  ██║██║██║ ╚═╝ ██║███████╗██║  ██║██║  ██║
    ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝${R}

${TEAL}${BOLD}        ◈══════════════════════════════════════════◈${R}
${TEAL}${BOLD}        ║  ${WHITE}${BOLD}  🧬  CROSS-PROVIDER INTELLIGENCE  🐉  ${TEAL}${BOLD}║${R}
${TEAL}${BOLD}        ◈══════════════════════════════════════════◈${R}

${DIM}${ROSE}           ╱╲    Multi-headed mythical creature${R}
${DIM}${ROSE}          ╱◉◉╲   bridging the AI divide.${R}
${DIM}${TEAL}         ╱╱  ╲╲  One API. Every provider.${R}
${DIM}${TEAL}        🄰🄿🄸 🅁🄾🅄🅃🄴🅁 🄵🄰🄸🄻🄾🅅🄴🅁${R}
${DIM}        ─────────────────────────────────────────${R}
${DIM}  Anthropic ${ROSE}■${R}${DIM}  OpenAI ${TEAL}■${R}${DIM}  Google ${WHITE}■${R}${DIM}  + Custom Providers${R}
`);
}

// ── Commands ───────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0] || 'status';

const chimera = new Chimera();

switch (command) {
  case 'status': {
    printBanner();
    console.log(`${BOLD}${WHITE}  Provider Status${R}\n`);
    const statuses = chimera.status();
    for (const s of statuses) {
      const health = s.healthy ? `${TEAL}●${R}` : `${ROSE}●${R}`;
      const enabled = s.enabled ? 'enabled' : `${DIM}disabled${R}`;
      const key = chimera.registry.getApiKey(s.id) ? `${TEAL}key set${R}` : `${DIM}no key${R}`;
      console.log(`  ${health} ${BOLD}${s.name}${R} (${s.id}) — ${enabled} — ${key}`);
      console.log(`    ${DIM}Models: ${s.models.join(', ')}${R}`);
    }
    console.log();
    break;
  }

  case 'providers': {
    const providers = chimera.registry.list();
    console.log(`\n${BOLD}Registered Providers:${R}\n`);
    for (const p of providers) {
      console.log(`  ${BOLD}${p.id}${R}: ${p.name}`);
      console.log(`    Base URL: ${p.baseUrl}`);
      console.log(`    Models: ${p.models.join(', ')}`);
      console.log(`    Capabilities: ${p.capabilities.join(', ')}`);
      console.log(`    Cost: $${p.costPer1kInput}/1k in, $${p.costPer1kOutput}/1k out`);
      console.log(`    Quality: ${p.qualityScore}/100\n`);
    }
    break;
  }

  case 'ask': {
    const prompt = args.slice(1).join(' ');
    if (!prompt) {
      console.error(`${ROSE}Usage: chimera ask <prompt>${R}`);
      process.exit(1);
    }
    try {
      const response = await chimera.ask(prompt);
      console.log(`\n${TEAL}[${response.provider}/${response.model}]${R}\n`);
      console.log(response.content);
      console.log(`\n${DIM}Tokens: ${response.usage.totalTokens} | Latency: ${response.latencyMs}ms${R}\n`);
    } catch (err) {
      console.error(`${ROSE}Error: ${err.message}${R}`);
      process.exit(1);
    }
    break;
  }

  case 'help':
  default:
    printBanner();
    console.log(`${BOLD}${WHITE}  Commands:${R}
    ${TEAL}status${R}        Show provider status (default)
    ${TEAL}providers${R}     List all registered providers with details
    ${TEAL}ask <prompt>${R}  Send a prompt to the best available provider
    ${TEAL}help${R}          Show this help message
`);
    break;
}
