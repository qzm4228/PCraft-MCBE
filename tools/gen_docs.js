/*
 * Regenerates the procedure index in docs/file-mapping.md from the extracted jar.
 * Requires ./.work/mod (tools/extract.ps1).
 * Run: node tools/gen_docs.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, '.work', 'mod');
const PROC_DIR = path.join(MOD, 'net', 'mcreator', 'pcraftrevorn', 'procedures');
const DOC = path.join(ROOT, 'docs', 'file-mapping.md');

const RULES = [
  [/^A\d+Procedure$|^ABaseProcedure$/, '通用数值/工具', 'P3'],
  [/Struggle|DownCorrect|DownIdle|DownIncorrect|DownOff|UpCorrect|UpIdle|UpIncorrect|UpOff|LeftCorrect|LeftIdle|LeftIncorrect|LeftOff|RightCorrect|RightIdle|RightIncorrect|RightOff|BoundMove|BoundX/, '挣扎/束缚', 'P4'],
  [/^WG|WGSet|WG1|WG2|TextureAssigner|ReturnSize/, '体重增长/WG', 'P5'],
  [/Digest|DProgress|ReturnDige|ReturnMaxTimer|ReturnHealthThreshold/, '消化', 'P3'],
  [/Regurgit|StartFull|StopFull/, '反刍', 'P3'],
  [/MobEat|EatPrey|EatTamed|EntitySwallowHandler|SwallowTargetCheck|SwallowAnimPlayer|ReturnSwallowChance|PiglinBoundCapture|PiglinFull|MaidenFull|ZombieFull|PiglinKnightFull/, '吞食核心', 'P3'],
  [/^Open/, '指南书 UI', 'P7'],
  [/Rabbit|CupidsArrow|Cupid/, '兔法师/法杖', 'P5'],
  [/Piglin/, '猪灵王', 'P5'],
  [/Vinemaiden|VineStop/, '藤娘', 'P5'],
  [/Scarecrow/, '稻草人', 'P5'],
  [/Silverfish/, '蠹虫', 'P5'],
  [/Basaltmite|GildedBasaltmite/, '玄武岩虫', 'P5'],
  [/^Zombie|ZombieGirl|ZombieMellow/, '吞食僵尸', 'P5'],
  [/Bound|Escape/, '束缚/逃脱', 'P4'],
  [/Ward|Shielded|ShieldingRing/, '护盾/守护', 'P5'],
  [/Carbonated|Neutralizing|PlaySound|VisualFX|PotionApplied|Softened|RottenStench|Delectable|Glowberry|Bloodlust|RabbitMarked/, '状态效果', 'P5'],
  [/Porkchop|Bones|Reward|Drop|GEP|BookChecks|EntityCodeNames|PRK|PR[A-Z]/, '辅助/生物参数', 'P5'],
];

function classify(name) {
  for (const [re, mod, phase] of RULES) if (re.test(name)) return [mod, phase];
  return ['通用事件', 'P5'];
}

function main() {
  if (!fs.existsSync(PROC_DIR)) { console.error('Missing ' + PROC_DIR); process.exit(1); }
  const names = fs.readdirSync(PROC_DIR).filter(f => f.endsWith('.class') && !/\$\d/.test(f)).map(f => f.replace(/\.class$/, '')).sort();
  const rows = names.map(n => { const [mod, phase] = classify(n); return { n, mod, phase }; });
  const groups = {};
  for (const r of rows) (groups[r.mod] = groups[r.mod] || []).push(r);
  let out = `| procedure | 目标模块 | 阶段 |\n|---|---|---|\n`;
  for (const mod of Object.keys(groups).sort()) {
    for (const r of groups[mod]) out += `| \`${r.n}\` | ${r.mod} | ${r.phase} |\n`;
  }
  out += `\n> 共 ${names.length} 个 procedure。目标模块名对应 \`behavior_pack/scripts/\` 下的子目录（P3 起建立）。\n`;
  const md = fs.readFileSync(DOC, 'utf8');
  fs.writeFileSync(DOC, md.replace('<!--PROC-->', out.trim()));
  console.log('Updated procedure index (%d entries).', names.length);
}
main();
