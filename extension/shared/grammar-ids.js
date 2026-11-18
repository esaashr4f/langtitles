// The fixed set of grammar-form identifiers. The line analysis is asked to use these, so the
// same form always gets the same identifier and its guide is written (or read from the built-in
// library) once, instead of again under a slightly different name. Forms not listed here still
// get an identifier of the same shape.
(function () {
  'use strict';
  const SG = (globalThis.SG = globalThis.SG || {});

  const IDS = {
    ja: [
      // particles
      'particle_wa', 'particle_ga', 'particle_wo', 'particle_ni', 'particle_de', 'particle_e', 'particle_to', 'particle_mo',
      'particle_no', 'particle_kara', 'particle_made', 'particle_yori', 'particle_ya', 'particle_dake', 'particle_shika',
      'particle_bakari', 'particle_nado', 'particle_koso', 'particle_sae', 'particle_demo', 'particle_nante', 'particle_tte',
      // sentence endings
      'ending_yo', 'ending_ne', 'ending_yo_ne', 'ending_ka', 'ending_na', 'ending_zo_ze', 'ending_sa', 'ending_kana',
      'ending_no', 'ending_wa', 'ending_kke', 'ending_mono',
      // verb and adjective forms
      'polite_masu', 'copula_da_desu', 'past_ta', 'negative_nai', 'negative_past_nakatta', 'te_form', 'volitional',
      'potential', 'passive', 'causative', 'causative_passive', 'imperative', 'prohibitive_na', 'tai_want',
      'conditional_ba', 'conditional_tara', 'conditional_to', 'conditional_nara', 'masu_stem', 'adjective_i', 'adjective_na',
      'adverbial_ku_ni', 'honorific', 'humble',
      // helper verbs after て
      'te_iru', 'te_aru', 'te_shimau', 'te_oku', 'te_miru', 'te_iku_kuru', 'te_kureru', 'te_ageru', 'te_morau',
      'te_kudasai', 'te_mo_ii', 'te_wa_ikenai', 'te_hoshii',
      // connecting clauses
      'reason_kara_node', 'though_kedo_ga', 'though_noni', 'while_nagara', 'tari_tari', 'shi_listing', 'te_mo_even_if',
      // patterns and expressions
      'explanatory_n_da', 'darou_deshou', 'kamoshirenai', 'hazu', 'sou_hearsay', 'sou_looks', 'you_mitai', 'rashii',
      'beki', 'nakereba_naranai', 'nakute_mo_ii', 'koto_ga_aru', 'koto_ga_dekiru', 'tsumori', 'tokoro', 'bakari_just',
      'sugiru', 'yasui_nikui', 'hou_ga_ii', 'to_omou', 'to_iu', 'quotation_to_tte', 'nominalizer_no_koto', 'wake',
      'zu_ni', 'mama', 'uchi_ni', 'tame_ni', 'you_ni', 'n_ja_nai', 'janai_ka', 'ka_dou_ka', 'question_word_ka_mo',
    ],
    ko: [
      'particle_topic_eun_neun', 'particle_subject_i_ga', 'particle_object_eul_reul', 'particle_e', 'particle_eseo',
      'particle_ege_hante', 'particle_do', 'particle_man', 'particle_ui', 'particle_wa_gwa_hago_rang', 'particle_ro_euro',
      'particle_buteo_kkaji', 'particle_boda', 'particle_cheoreom',
      'polite_ayo_eoyo', 'formal_seumnida', 'casual_banmal', 'honorific_si', 'past_at_eot', 'future_geot_ida', 'future_gesseo',
      'negative_an', 'negative_ji_anta', 'negative_mot', 'imperative', 'propositive_ja', 'copula_ida',
      'connective_aseo', 'connective_go', 'connective_neunde', 'connective_jiman', 'connective_eumyeon', 'connective_nikka',
      'connective_neunde_background', 'connective_doe', 'connective_ryeogo', 'connective_reo', 'connective_dorok',
      'modifier_neun_eun_eul', 'nominalizer_gi', 'nominalizer_eum', 'nominalizer_geot',
      'ending_ne', 'ending_gun_guna', 'ending_ji', 'ending_ge', 'ending_kka', 'ending_ne_question', 'ending_jana',
      'ending_eulgeol', 'ending_geodeun', 'ending_deo_ra', 'ending_daeyo_quote',
      'aux_go_itta', 'aux_a_itta', 'aux_a_juda', 'aux_a_boda', 'aux_a_beorida', 'aux_a_noh_da', 'aux_go_sipda',
      'aux_a_ya_hada', 'aux_a_do_doeda', 'aux_eumyeon_an_doeda', 'aux_eul_su_itta', 'aux_eul_geot_gatda', 'aux_ge_doeda',
      'aux_a_jida', 'aux_eo_hada', 'quotation_dago',
    ],
    zh: [
      'particle_de_possessive', 'particle_de_adverbial', 'particle_de_complement', 'aspect_le', 'sentence_le', 'aspect_guo',
      'aspect_zhe', 'progressive_zai', 'particle_ma', 'particle_ne', 'particle_ba', 'particle_a', 'particle_ya_ou',
      'ba_construction', 'bei_passive', 'shi_de', 'resultative_complement', 'directional_complement', 'potential_complement',
      'degree_complement', 'measure_word', 'comparison_bi', 'comparison_mei_you', 'reduplication', 'negation_bu_mei',
      'modal_hui_neng_keyi', 'modal_yao_xiang', 'modal_yinggai', 'yi_jiu', 'you_you', 'yue_yue', 'yinwei_suoyi',
      'suiran_danshi', 'ruguo_jiu', 'lian_dou', 'ji_le', 'jiu_cai', 'hai', 'question_words', 'rhetorical_bu_shi_ma',
    ],
  };

  // Names the analysis has been seen to use for the same form, mapped to the fixed identifier.
  const ALIASES = {
    ja: {
      te: 'te_form', te_form_request: 'te_form', te_request: 'te_form', te_connective: 'te_form', te_conjunctive: 'te_form',
      te_imperative: 'te_form', te_form_command: 'te_form',
      wa: 'particle_wa', topic_wa: 'particle_wa', topic_marker_wa: 'particle_wa', particle_ha: 'particle_wa',
      ga: 'particle_ga', subject_ga: 'particle_ga', subject_marker_ga: 'particle_ga',
      wo: 'particle_wo', o: 'particle_wo', particle_o: 'particle_wo', object_wo: 'particle_wo', object_marker_wo: 'particle_wo',
      ni: 'particle_ni', de: 'particle_de', mo: 'particle_mo', no: 'particle_no', particle_no_possessive: 'particle_no',
      kara: 'particle_kara', made: 'particle_made', to: 'particle_to',
      particle_yo: 'ending_yo', sentence_final_yo: 'ending_yo', yo: 'ending_yo',
      particle_ne: 'ending_ne', sentence_final_ne: 'ending_ne', ne: 'ending_ne', yone: 'ending_yo_ne', particle_yone: 'ending_yo_ne',
      particle_ka: 'ending_ka', question_ka: 'ending_ka', sentence_final_ka: 'ending_ka',
      particle_na: 'ending_na', sentence_final_na: 'ending_na', particle_zo: 'ending_zo_ze', particle_ze: 'ending_zo_ze',
      particle_sa: 'ending_sa', particle_kana: 'ending_kana', particle_kke: 'ending_kke',
      masu: 'polite_masu', masu_form: 'polite_masu', polite: 'polite_masu', polite_form: 'polite_masu',
      da: 'copula_da_desu', desu: 'copula_da_desu', copula: 'copula_da_desu', copula_da: 'copula_da_desu', copula_desu: 'copula_da_desu',
      past: 'past_ta', ta_form: 'past_ta', past_tense: 'past_ta', plain_past: 'past_ta', ta: 'past_ta',
      nai: 'negative_nai', negative: 'negative_nai', nai_form: 'negative_nai', plain_negative: 'negative_nai',
      nakatta: 'negative_past_nakatta', past_negative: 'negative_past_nakatta',
      volitional_form: 'volitional', volitional_ou: 'volitional', volitional_you: 'volitional', mashou: 'volitional',
      potential_form: 'potential', passive_form: 'passive', passive_rareru: 'passive',
      causative_form: 'causative', causative_saseru: 'causative', causative_passive_form: 'causative_passive',
      imperative_form: 'imperative', command: 'imperative',
      tai: 'tai_want', tai_form: 'tai_want', desire_tai: 'tai_want', want_tai: 'tai_want',
      ba: 'conditional_ba', ba_conditional: 'conditional_ba', ba_form: 'conditional_ba',
      tara: 'conditional_tara', tara_conditional: 'conditional_tara', to_conditional: 'conditional_to', nara: 'conditional_nara',
      teiru: 'te_iru', te_iru_progressive: 'te_iru', progressive: 'te_iru', te_iru_state: 'te_iru', teru: 'te_iru', te_ru: 'te_iru',
      te_shimau_completion: 'te_shimau', te_shimau_regret: 'te_shimau', chau: 'te_shimau', chimau: 'te_shimau',
      te_kudasai_request: 'te_kudasai', kudasai: 'te_kudasai', temoii: 'te_mo_ii', te_wa_ikenai_prohibition: 'te_wa_ikenai',
      n_desu: 'explanatory_n_da', no_da: 'explanatory_n_da', n_da: 'explanatory_n_da', explanatory_no: 'explanatory_n_da',
      noda: 'explanatory_n_da', explanatory_n: 'explanatory_n_da',
      darou: 'darou_deshou', deshou: 'darou_deshou', kamo: 'kamoshirenai', kamo_shirenai: 'kamoshirenai',
      kedo: 'though_kedo_ga', keredo: 'though_kedo_ga', ga_but: 'though_kedo_ga', noni: 'though_noni',
      kara_reason: 'reason_kara_node', node: 'reason_kara_node', nagara: 'while_nagara', tari: 'tari_tari',
      mitai: 'you_mitai', you_da: 'you_mitai', souda_hearsay: 'sou_hearsay', souda_appearance: 'sou_looks',
      nakereba_ikenai: 'nakereba_naranai', nakya: 'nakereba_naranai', nakucha: 'nakereba_naranai',
      tte_quote: 'quotation_to_tte', quotative_to: 'quotation_to_tte', quotation_to: 'quotation_to_tte',
      janai: 'n_ja_nai', n_janai: 'n_ja_nai',
    },
    ko: {}, zh: {},
  };

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const known = {};
  for (const [lang, list] of Object.entries(IDS)) known[lang] = new Set(list);

  // ja.te_form_request -> ja.te_form; unknown identifiers are only tidied.
  SG.canonicalForm = function (k) {
    const text = String(k || '');
    const dot = text.indexOf('.');
    if (dot < 0 || text.startsWith('word.')) return text;
    const lang = text.slice(0, dot).toLowerCase();
    const id = norm(text.slice(dot + 1));
    if (!id) return text;
    if (known[lang] && known[lang].has(id)) return lang + '.' + id;
    const alias = ALIASES[lang] && ALIASES[lang][id];
    if (alias) return lang + '.' + alias;
    return lang + '.' + id;
  };

  SG.GRAMMAR_IDS = IDS;
})();
