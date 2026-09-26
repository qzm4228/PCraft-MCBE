/*
 * Generates the P2.5 custom form UI (JSON-UI).
 * Overrides the vanilla `server_form.third_party_server_screen` (partial
 * override via a uniquely named file) to add a progress bar layer that is
 * driven by invisible title markers (see behavior_pack/scripts/pcraftrevorn/constants.js).
 *
 * Run: node tools/generate_ui.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RP = path.join(ROOT, 'resource_pack');
const HEX = '0123456789abcdef';
const TITLE_MARKER = '§0§r§1§r';
const PROGRESS_MARKER = '§2§r';
const LEVELS = 16;
const BAR_W = 204, BAR_H = 8, FILL_H = 4, PAD = 2;

function writeJSON(f, o) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); }
function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

function genFills() {
  const controls = [];
  for (let i = 0; i < LEVELS; i++) {
    const w = Math.round(6 + (i * (BAR_W - 2 * PAD - 6)) / (LEVELS - 1));
    controls.push({
      [`fill_${i}`]: {
        type: 'panel',
        layer: 2,
        anchor_from: 'top_left',
        anchor_to: 'top_left',
        offset: [PAD, PAD],
        size: [w, FILL_H],
        clips_children: true,
        property_bag: { '#current_title_text': '' },
        controls: [
          { fill_image: { type: 'image', anchor_from: 'top_left', anchor_to: 'top_left', size: [w, FILL_H], texture: 'textures/ui/White', color: [0.4, 0.85, 0.45] } }
        ],
        bindings: [
          { binding_name: '#title_text', binding_name_override: '#current_title_text' },
          {
            binding_type: 'view',
            source_property_name: `(not ((#current_title_text - '${PROGRESS_MARKER}§${HEX[i]}§r') = #current_title_text))`,
            target_property_name: '#visible'
          }
        ]
      }
    });
  }
  return controls;
}

const ui = {
  namespace: 'server_form',
  'third_party_server_screen@common.base_screen': {
    '$screen_content': 'server_form.main_screen_content',
    '$additional_screen_content': 'server_form.pcraftrevorn_additional_content',
    button_mappings: [
      { from_button_id: 'button.menu_cancel', to_button_id: 'button.menu_exit', mapping_type: 'global' }
    ]
  },
  pcraftrevorn_additional_content: {
    type: 'panel',
    size: ['100%', '100%'],
    controls: [{ 'layer@server_form.pcraftrevorn_layer': {} }]
  },
  pcraftrevorn_layer: {
    type: 'panel',
    size: ['100%', '100%'],
    bindings: [
      { binding_name: '#title_text' },
      {
        binding_type: 'view',
        source_property_name: `(not ((#title_text - '${TITLE_MARKER}') = #title_text))`,
        target_property_name: '#visible'
      }
    ],
    controls: [
      {
        'bar@server_form.pcraftrevorn_progress_bar': {
          anchor_from: 'bottom_middle',
          anchor_to: 'bottom_middle',
          offset: [0, -14]
        }
      }
    ]
  },
  pcraftrevorn_progress_bar: {
    type: 'panel',
    size: [BAR_W, BAR_H],
    controls: [
      { track: { type: 'image', size: ['100%', '100%'], texture: 'textures/ui/White', color: [0.08, 0.08, 0.08], alpha: 0.65 } },
      ...genFills(),
      {
        frame: {
          type: 'image',
          layer: 3,
          size: ['100%', '100%'],
          texture: 'textures/ui/White',
          color: [0.6, 0.6, 0.6],
          alpha: 0.25
        }
      }
    ]
  }
};

rmrf(path.join(RP, 'ui'));
writeJSON(path.join(RP, 'ui', 'pcraftrevorn_forms.json'), ui);
writeJSON(path.join(RP, 'ui', '_ui_defs.json'), { ui_defs: ['ui/pcraftrevorn_forms.json'] });
console.log('Generated resource_pack/ui/pcraftrevorn_forms.json + _ui_defs.json');
