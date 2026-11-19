// Japanese deinflection: from a conjugated form back to candidate dictionary forms
// (頑張って → 頑張る, 食べさせられた → 食べる, 高くなかった → 高い), each with the word type it must be.
// Rules are applied repeatedly, so chains of endings unwind one step at a time.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  // [ending as written, replacement, types this ending can follow (what the result must be), type of the input]
  // Types: v1 ichidan, v5 godan, vk 来る, vs する, adj (i-adjective), and 'any' for the conjugated input.
  const R = [];
  const add = (from, to, out, label) => R.push({ from, to, out, label });
  // godan endings by column
  const GODAN = { う: ['わ', 'い', 'え', 'お', 'っ'], く: ['か', 'き', 'け', 'こ', 'い'], ぐ: ['が', 'ぎ', 'げ', 'ご', 'い'], す: ['さ', 'し', 'せ', 'そ', 'し'], つ: ['た', 'ち', 'て', 'と', 'っ'], ぬ: ['な', 'に', 'ね', 'の', 'ん'], ぶ: ['ば', 'び', 'べ', 'ぼ', 'ん'], む: ['ま', 'み', 'め', 'も', 'ん'], る: ['ら', 'り', 'れ', 'ろ', 'っ'] };
  for (const [u, [a, i, e, o, te]] of Object.entries(GODAN)) {
    const voiced = u === 'ぐ' || u === 'ぬ' || u === 'ぶ' || u === 'む';
    const t = voiced ? 'で' : 'て';
    const ta = voiced ? 'だ' : 'た';
    const teStem = u === 'す' ? 'し' : te;
    add(teStem + t, u, 'v5', 'te-form');
    add(teStem + ta, u, 'v5', 'past');
    add(teStem + ta + 'ら', u, 'v5', 'conditional -tara');
    add(teStem + ta + 'り', u, 'v5', '-tari');
    add(a + 'ない', u, 'v5', 'negative');
    add(a + 'ず', u, 'v5', 'negative -zu');
    add(a + 'ぬ', u, 'v5', 'negative -nu');
    add(a + 'れる', u, 'v5', 'passive');
    add(a + 'せる', u, 'v5', 'causative');
    add(a + 'す', u, 'v5', 'causative (short)');
    add(a + 'される', u, 'v5', 'causative-passive');
    add(i + 'ます', u, 'v5', 'polite');
    add(i + 'ました', u, 'v5', 'polite past');
    add(i + 'ません', u, 'v5', 'polite negative');
    add(i + 'たい', u, 'v5', 'want to');
    add(i + 'そう', u, 'v5', 'looks like');
    add(i + 'ながら', u, 'v5', 'while');
    add(i, u, 'v5', 'stem');
    add(e + 'る', u, 'v5', 'potential');
    add(e + 'ば', u, 'v5', 'conditional -ba');
    add(e, u, 'v5', 'imperative');
    add(o + 'う', u, 'v5', 'volitional');
    add(teStem + t + 'いる', u, 'v5', '-te iru');
    add(teStem + t + 'る', u, 'v5', '-te(i)ru');
    add(teStem + (voiced ? 'じゃう' : 'ちゃう'), u, 'v5', '-chau');
    add(teStem + (voiced ? 'じゃった' : 'ちゃった'), u, 'v5', '-chatta');
    add(teStem + t + 'しまう', u, 'v5', '-te shimau');
  }
  // 行く is irregular in the te- and ta-forms
  add('行って', '行く', 'v5', 'te-form');
  add('行った', '行く', 'v5', 'past');
  add('いって', 'いく', 'v5', 'te-form');
  add('いった', 'いく', 'v5', 'past');
  // ichidan
  for (const [from, label] of [['て', 'te-form'], ['た', 'past'], ['たら', 'conditional -tara'], ['たり', '-tari'], ['ない', 'negative'], ['ず', 'negative -zu'], ['ぬ', 'negative -nu'], ['られる', 'passive / potential'], ['れる', 'potential (colloquial)'], ['させる', 'causative'], ['さす', 'causative (short)'], ['させられる', 'causative-passive'], ['ます', 'polite'], ['ました', 'polite past'], ['ません', 'polite negative'], ['たい', 'want to'], ['そう', 'looks like'], ['ながら', 'while'], ['れば', 'conditional -ba'], ['ろ', 'imperative'], ['よ', 'imperative'], ['よう', 'volitional'], ['ている', '-te iru'], ['てる', '-te(i)ru'], ['ちゃう', '-chau'], ['ちゃった', '-chatta'], ['てしまう', '-te shimau'], ['', 'stem']]) {
    add(from, 'る', 'v1', label);
  }
  // する / 来る
  for (const [form, label] of [['して', 'te-form'], ['した', 'past'], ['しない', 'negative'], ['される', 'passive'], ['させる', 'causative'], ['させられる', 'causative-passive'], ['します', 'polite'], ['しました', 'polite past'], ['しません', 'polite negative'], ['したい', 'want to'], ['すれば', 'conditional -ba'], ['しろ', 'imperative'], ['しよう', 'volitional'], ['できる', 'potential'], ['している', '-te iru'], ['してる', '-te(i)ru'], ['したら', 'conditional -tara'], ['せず', 'negative -zu'], ['し', 'stem']]) {
    add(form, 'する', 'vs', label);
  }
  for (const [form, label] of [['来て', 'te-form'], ['来た', 'past'], ['来ない', 'negative'], ['来られる', 'passive / potential'], ['来させる', 'causative'], ['来ます', 'polite'], ['来ました', 'polite past'], ['来い', 'imperative'], ['来よう', 'volitional'], ['来れば', 'conditional -ba'], ['きて', 'te-form'], ['きた', 'past'], ['こない', 'negative'], ['こい', 'imperative'], ['こよう', 'volitional'], ['くれば', 'conditional -ba']]) {
    add(form, form.startsWith('来') ? '来る' : 'くる', 'vk', label);
  }
  // i-adjectives
  for (const [from, label] of [['くない', 'negative'], ['かった', 'past'], ['くなかった', 'negative past'], ['くて', 'te-form'], ['ければ', 'conditional -ba'], ['かったら', 'conditional -tara'], ['く', 'adverb'], ['さ', 'noun -sa'], ['そう', 'looks'], ['すぎる', 'too'], ['くなる', 'become']]) {
    add(from, 'い', 'adj', label);
  }
  add('よくない', 'いい', 'adj', 'negative');
  add('よかった', 'いい', 'adj', 'past');
  add('よくて', 'いい', 'adj', 'te-form');
  // Endings that themselves conjugate like a word (ない, たい, られる…) feed back in.
  const CHAINS = [['なかった', 'ない'], ['なくて', 'ない'], ['なければ', 'ない'], ['なきゃ', 'ない'], ['たかった', 'たい'], ['たくない', 'たい'], ['られた', 'られる'], ['られない', 'られる'], ['られて', 'られる'], ['させた', 'させる'], ['させて', 'させる'], ['れた', 'れる'], ['れない', 'れる'], ['れて', 'れる'], ['ませんでした', 'ません'], ['ていた', 'ている'], ['ていない', 'ている'], ['てた', 'てる'], ['でいた', 'でいる'], ['でた', 'でる'], ['てしまった', 'てしまう'], ['ちゃった', 'ちゃう']];

  const TYPES = { v1: /v1/, v5: /v5/, vk: /vk/, vs: /vs/, adj: /adj-i/ };

  // Candidate dictionary forms of `word`, each { form, type, steps }; the word itself comes first.
  function deinflect(word) {
    const out = [{ form: word, type: null, steps: [] }];
    const seen = new Set([word]);
    const queue = [{ form: word, steps: [] }];
    while (queue.length && out.length < 60) {
      const cur = queue.shift();
      if (cur.steps.length > 4) continue;
      for (const [from, to] of CHAINS) {
        if (cur.form.endsWith(from) && cur.form.length > from.length) {
          const f = cur.form.slice(0, -from.length) + to;
          if (!seen.has(f)) {
            seen.add(f);
            queue.push({ form: f, steps: cur.steps.concat(from) });
          }
        }
      }
      for (const r of R) {
        if (!cur.form.endsWith(r.from)) continue;
        const base = cur.form.slice(0, cur.form.length - r.from.length);
        if (!base && r.to.length < 2) continue;
        const f = base + r.to;
        if (seen.has(f) || f === cur.form) continue;
        seen.add(f);
        const steps = cur.steps.concat(r.label);
        out.push({ form: f, type: r.out, steps });
        queue.push({ form: f, steps });
      }
    }
    return out;
  }

  // Does a dictionary entry's part of speech fit the type deinflection needs?
  function fits(entry, type) {
    if (!type) return true;
    const pos = entry.s.map((x) => x[0]).join(',');
    return TYPES[type] ? TYPES[type].test(pos) : true;
  }

  SG.deinflect = { deinflect, fits };
})(typeof globalThis !== 'undefined' ? globalThis : this);
