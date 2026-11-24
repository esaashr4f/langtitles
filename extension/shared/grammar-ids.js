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
      // combined particles and forms added with phrases (0.2.1)
      'dewa_contrast', 'dewa_nai', 'conj_dewa', 'particle_ni_wa', 'particle_to_wa', 'particle_kara_wa', 'particle_made_wa',
      'particle_demo', 'particle_ni_mo', 'noun_modifying_clause', 'nari', 'toori', 'mono_wa_mono', 'teki', 'ikani_ka',
      'ni_mieru', 'to_suru', 'koto_noun_ni_kanshite',
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
      particle_dewa: 'dewa_contrast', dewa: 'dewa_contrast', de_wa: 'dewa_contrast', particle_de_wa: 'dewa_contrast',
      ja_nai: 'dewa_nai', de_wa_nai: 'dewa_nai', negative_copula: 'dewa_nai', copula_negative: 'dewa_nai',
      relative_clause: 'noun_modifying_clause', noun_modification: 'noun_modifying_clause', modifying_clause: 'noun_modifying_clause',
      niwa: 'particle_ni_wa', ni_wa: 'particle_ni_wa', towa: 'particle_to_wa', demo: 'particle_demo', nimo: 'particle_ni_mo',
      fn_なり: 'nari', fn_とおり: 'toori', fn_どおり: 'toori', fn_通り: 'toori', fn_的: 'teki', fn_では: 'dewa_contrast', fn_じゃ: 'dewa_contrast',
      fn_には: 'particle_ni_wa', fn_とは: 'particle_to_wa', fn_でも: 'particle_demo', fn_にも: 'particle_ni_mo',
      fn_は: 'particle_wa', fn_が: 'particle_ga', fn_を: 'particle_wo', fn_に: 'particle_ni', fn_で: 'particle_de', fn_も: 'particle_mo',
      fn_の: 'particle_no', fn_と: 'particle_to', fn_から: 'particle_kara', fn_まで: 'particle_made', fn_など: 'particle_nado',
      fn_だけ: 'particle_dake', fn_しか: 'particle_shika', fn_ばかり: 'particle_bakari', fn_こそ: 'particle_koso', fn_って: 'quotation_to_tte',
      fn_よ: 'ending_yo', fn_ね: 'ending_ne', fn_か: 'ending_ka', fn_な: 'ending_na', fn_さ: 'ending_sa', fn_かな: 'ending_kana',
      fn_だ: 'copula_da_desu', fn_です: 'copula_da_desu', fn_らしい: 'rashii', fn_みたい: 'you_mitai', fn_よう: 'you_mitai',
    },
    ko: {
      // particles
      topic: 'particle_topic_eun_neun', topic_marker: 'particle_topic_eun_neun', eun_neun: 'particle_topic_eun_neun', particle_eun: 'particle_topic_eun_neun', particle_neun: 'particle_topic_eun_neun', topic_particle: 'particle_topic_eun_neun',
      subject: 'particle_subject_i_ga', subject_marker: 'particle_subject_i_ga', i_ga: 'particle_subject_i_ga', particle_i: 'particle_subject_i_ga', particle_ga: 'particle_subject_i_ga', subject_particle: 'particle_subject_i_ga',
      object: 'particle_object_eul_reul', object_marker: 'particle_object_eul_reul', object_particle: 'particle_object_eul_reul', eul_reul: 'particle_object_eul_reul', particle_eul: 'particle_object_eul_reul', particle_reul: 'particle_object_eul_reul', particle_object: 'particle_object_eul_reul',
      ege: 'particle_ege_hante', hante: 'particle_ege_hante', dative: 'particle_ege_hante', dative_ege: 'particle_ege_hante', particle_ege: 'particle_ege_hante', particle_hante: 'particle_ege_hante', ege_contracted: 'particle_ege_hante', dative_particle: 'particle_ege_hante',
      eseo: 'particle_eseo', location_eseo: 'particle_eseo', particle_e_location: 'particle_e', location_e: 'particle_e', direction_e: 'particle_e',
      possessive: 'particle_ui', possessive_ui: 'particle_ui', ui: 'particle_ui', possessive_particle: 'particle_ui',
      also_do: 'particle_do', only_man: 'particle_man', ro: 'particle_ro_euro', euro: 'particle_ro_euro', instrumental: 'particle_ro_euro', means_ro: 'particle_ro_euro', direction_ro: 'particle_ro_euro',
      wa_gwa: 'particle_wa_gwa_hago_rang', hago: 'particle_wa_gwa_hago_rang', rang: 'particle_wa_gwa_hago_rang', and_particle: 'particle_wa_gwa_hago_rang',
      buteo: 'particle_buteo_kkaji', kkaji: 'particle_buteo_kkaji', boda: 'particle_boda', comparison_boda: 'particle_boda', cheoreom: 'particle_cheoreom', like_cheoreom: 'particle_cheoreom',
      // speech levels
      casual: 'casual_banmal', casual_speech: 'casual_banmal', banmal: 'casual_banmal', informal: 'casual_banmal', haeche: 'casual_banmal', casual_ending: 'casual_banmal', banmal_casual: 'casual_banmal', informal_speech: 'casual_banmal', casual_present: 'casual_banmal', plain_casual: 'casual_banmal',
      polite: 'polite_ayo_eoyo', haeyo: 'polite_ayo_eoyo', polite_yo: 'polite_ayo_eoyo', yo: 'polite_ayo_eoyo', polite_ending: 'polite_ayo_eoyo', haeyoche: 'polite_ayo_eoyo', informal_polite: 'polite_ayo_eoyo',
      formal: 'formal_seumnida', seumnida: 'formal_seumnida', hapsyo: 'formal_seumnida', formal_polite: 'formal_seumnida', hamnida: 'formal_seumnida',
      past: 'past_at_eot', past_tense: 'past_at_eot', past_eot: 'past_at_eot', past_at: 'past_at_eot',
      honorific: 'honorific_si', honorific_suffix: 'honorific_si',
      // auxiliaries
      a_juda: 'aux_a_juda', eo_juda: 'aux_a_juda', juda: 'aux_a_juda', jwo: 'aux_a_juda', request_jwo: 'aux_a_juda', benefactive: 'aux_a_juda', do_for_me: 'aux_a_juda', aux_juda: 'aux_a_juda', casual_request: 'aux_a_juda', a_eo_juda: 'aux_a_juda',
      progressive: 'aux_go_itta', go_itda: 'aux_go_itta', go_itta: 'aux_go_itta', want: 'aux_go_sipda', go_sipda: 'aux_go_sipda', desire: 'aux_go_sipda',
      eul_su_itda: 'aux_eul_su_itta', can: 'aux_eul_su_itta', ability: 'aux_eul_su_itta', must: 'aux_a_ya_hada', a_ya_hada: 'aux_a_ya_hada',
      // connectives and endings
      aseo: 'connective_aseo', eoseo: 'connective_aseo', so_aseo: 'connective_aseo', and_go: 'connective_go', go: 'connective_go',
      neunde: 'connective_neunde', but_jiman: 'connective_jiman', jiman: 'connective_jiman', if_myeon: 'connective_eumyeon', myeon: 'connective_eumyeon', eumyeon: 'connective_eumyeon',
      nikka: 'connective_nikka', eunikka: 'connective_nikka', jana: 'ending_jana', janha: 'ending_jana', geodeun: 'ending_geodeun',
      modifier: 'modifier_neun_eun_eul', adnominal: 'modifier_neun_eun_eul', relative_clause: 'modifier_neun_eun_eul', noun_modifier: 'modifier_neun_eun_eul',
      negative: 'negative_an', negation_an: 'negative_an', an: 'negative_an', ji_anta: 'negative_ji_anta', mot: 'negative_mot',
      future: 'future_geot_ida', future_eul_geoya: 'future_geot_ida', eul_geoya: 'future_geot_ida', copula: 'copula_ida', ida: 'copula_ida',
      fn_은: 'particle_topic_eun_neun', fn_는: 'particle_topic_eun_neun', fn_ㄴ: 'particle_topic_eun_neun', fn_이: 'particle_subject_i_ga', fn_가: 'particle_subject_i_ga',
      fn_을: 'particle_object_eul_reul', fn_를: 'particle_object_eul_reul', fn_ㄹ: 'particle_object_eul_reul', fn_에: 'particle_e', fn_에서: 'particle_eseo', fn_서: 'particle_eseo',
      fn_에게: 'particle_ege_hante', fn_한테: 'particle_ege_hante', fn_께: 'particle_ege_hante', fn_게: 'particle_ege_hante', fn_에게서: 'particle_ege_hante', fn_한테서: 'particle_ege_hante',
      fn_도: 'particle_do', fn_만: 'particle_man', fn_의: 'particle_ui', fn_와: 'particle_wa_gwa_hago_rang', fn_과: 'particle_wa_gwa_hago_rang', fn_하고: 'particle_wa_gwa_hago_rang', fn_랑: 'particle_wa_gwa_hago_rang', fn_이랑: 'particle_wa_gwa_hago_rang',
      fn_로: 'particle_ro_euro', fn_으로: 'particle_ro_euro', fn_부터: 'particle_buteo_kkaji', fn_까지: 'particle_buteo_kkaji', fn_보다: 'particle_boda', fn_처럼: 'particle_cheoreom', fn_이다: 'copula_ida',
      propositive: 'propositive_ja', lets: 'propositive_ja', quotation: 'quotation_dago', reported_speech: 'quotation_dago', dago: 'quotation_dago',
    },
    zh: {
      de: 'particle_de_possessive', possessive: 'particle_de_possessive', possessive_de: 'particle_de_possessive', de_possessive: 'particle_de_possessive', attributive_de: 'particle_de_possessive', structural_de: 'particle_de_possessive', modifier_de: 'particle_de_possessive',
      adverbial_de: 'particle_de_adverbial', de_adverbial: 'particle_de_adverbial',
      complement_de: 'particle_de_complement', de_complement: 'particle_de_complement', degree_de: 'particle_de_complement',
      le: 'aspect_le', perfective_le: 'aspect_le', completion_le: 'aspect_le', verb_le: 'aspect_le', aspect_particle_le: 'aspect_le', past_le: 'aspect_le',
      change_le: 'sentence_le', modal_le: 'sentence_le', final_le: 'sentence_le', sentence_final_le: 'sentence_le', change_of_state_le: 'sentence_le',
      guo: 'aspect_guo', experiential_guo: 'aspect_guo', experience_guo: 'aspect_guo',
      zhe: 'aspect_zhe', durative_zhe: 'aspect_zhe', continuous_zhe: 'aspect_zhe',
      zai: 'progressive_zai', progressive: 'progressive_zai', zhengzai: 'progressive_zai', in_progress: 'progressive_zai',
      ma: 'particle_ma', question_ma: 'particle_ma', yes_no_question: 'particle_ma',
      ne: 'particle_ne', question_ne: 'particle_ne',
      ba: 'particle_ba', suggestion_ba: 'particle_ba', final_ba: 'particle_ba',
      a: 'particle_a', particle_ya: 'particle_ya_ou', ya: 'particle_ya_ou', ou: 'particle_ya_ou', wa: 'particle_a',
      ba_sentence: 'ba_construction', disposal_ba: 'ba_construction', ba_structure: 'ba_construction',
      bei: 'bei_passive', passive: 'bei_passive', passive_bei: 'bei_passive',
      shi_de_construction: 'shi_de', emphasis_shi_de: 'shi_de',
      resultative: 'resultative_complement', result_complement: 'resultative_complement',
      directional: 'directional_complement', potential: 'potential_complement', potential_de_bu: 'potential_complement',
      degree: 'degree_complement', measure: 'measure_word', classifier: 'measure_word', measure_words: 'measure_word',
      bi: 'comparison_bi', comparison: 'comparison_bi', comparative_bi: 'comparison_bi', mei_you_comparison: 'comparison_mei_you',
      bu: 'negation_bu_mei', mei: 'negation_bu_mei', meiyou: 'negation_bu_mei', negation: 'negation_bu_mei', negative: 'negation_bu_mei',
      hui: 'modal_hui_neng_keyi', neng: 'modal_hui_neng_keyi', keyi: 'modal_hui_neng_keyi', can: 'modal_hui_neng_keyi', ability: 'modal_hui_neng_keyi',
      yao: 'modal_yao_xiang', xiang: 'modal_yao_xiang', want: 'modal_yao_xiang', yinggai: 'modal_yinggai', should: 'modal_yinggai',
      yi_jiu_pattern: 'yi_jiu', youyou: 'you_you', yueyue: 'yue_yue', because_so: 'yinwei_suoyi', yinwei: 'yinwei_suoyi', suoyi: 'yinwei_suoyi',
      although_but: 'suiran_danshi', suiran: 'suiran_danshi', danshi: 'suiran_danshi', if_then: 'ruguo_jiu', ruguo: 'ruguo_jiu',
      even: 'lian_dou', lian: 'lian_dou', jile: 'ji_le', jiu: 'jiu_cai', cai: 'jiu_cai', still: 'hai', question_word: 'question_words',
      fn_的: 'particle_de_possessive', fn_地: 'particle_de_adverbial', fn_得: 'particle_de_complement', fn_了: 'aspect_le', fn_过: 'aspect_guo',
      fn_着: 'aspect_zhe', fn_在: 'progressive_zai', fn_正在: 'progressive_zai', fn_吗: 'particle_ma', fn_呢: 'particle_ne', fn_吧: 'particle_ba',
      fn_啊: 'particle_a', fn_呀: 'particle_ya_ou', fn_哦: 'particle_ya_ou', fn_把: 'ba_construction', fn_被: 'bei_passive', fn_比: 'comparison_bi',
      fn_不: 'negation_bu_mei', fn_没: 'negation_bu_mei', fn_没有: 'negation_bu_mei', fn_会: 'modal_hui_neng_keyi', fn_能: 'modal_hui_neng_keyi',
      fn_可以: 'modal_hui_neng_keyi', fn_要: 'modal_yao_xiang', fn_想: 'modal_yao_xiang', fn_应该: 'modal_yinggai', fn_就: 'jiu_cai', fn_才: 'jiu_cai',
      fn_还: 'hai', fn_因为: 'yinwei_suoyi', fn_所以: 'yinwei_suoyi', fn_虽然: 'suiran_danshi', fn_但是: 'suiran_danshi', fn_如果: 'ruguo_jiu',
      fn_連: 'lian_dou', fn_连: 'lian_dou', fn_極了: 'ji_le', fn_极了: 'ji_le',
    },
  };

  // Letters of any script survive (fn_なり), everything else becomes "_".
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
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
    // Korean and Chinese names not seen before: match by their key words (object_marker_eul -> the object particle).
    if (lang === 'ko' || lang === 'zh') {
      const parts = id.split('_');
      for (let n = parts.length - 1; n >= 1; n--) {
        for (let i = 0; i + n <= parts.length; i++) {
          const sub = parts.slice(i, i + n).join('_');
          if (known[lang].has(sub)) return lang + '.' + sub;
          if (ALIASES[lang][sub]) return lang + '.' + ALIASES[lang][sub];
        }
      }
    }
    return lang + '.' + id;
  };

  SG.GRAMMAR_IDS = IDS;
})();
