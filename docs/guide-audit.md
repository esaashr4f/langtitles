# Audit of your saved guides (160)

Exported 2026-11-19. 117 word guides, 43 grammar guides, all Japanese, all from Monster. Written by
Opus 5.5 (87), Sonnet 5.5 (61) and built in (12). Every guide has the right sections; the writing is
mostly accurate and often good. The problems are mostly **what a guide is attached to**, plus a few
real errors, some duplicates and an old style that still uses romaji.

## A. Phrases filed under one of their words (refile as the phrase; content is mostly right)

| Saved as | Should be | Line |
|---|---|---|
| 関する | **に関して / に関しては** (compound particle, "regarding / as for") | …オーベルト氏殺害に関しては |
| 歯切れ, and 悪い | **歯切れが悪い** (idiom, "evasive, vague") | 歯切れが悪いようだね |
| 専ら, and 評判 | **専らの評判だ** ("it's what everyone's saying") | 専らの評判だ |
| 実行 | **実行に移す** ("put into action") | で 俺は 実行に移した |
| 悪態 | **悪態をつく** ("curse, swear") | 俺は悪態をついた |
| 店 | **店を出す** ("open a shop / set up business") | 店を出したって |
| 必要, and と | **必要とする** ("need"; と here is the "treat as" と of とする) | 処女の血を必要としていた |
| いかに | **いかに…か** ("just how much…") | 君がいかに…必要としていたのかが |
| 見える | **～に見える** ("look like / pass for") | 10代に見える |
| いい | **～てもいい** (already a built-in guide; this one duplicates it) | 聞いてもいいかな |

## B. Grammar treated as a word (rewrite as grammar)

| Saved as | Problem |
|---|---|
| なり | Grammar suffix written as a word guide. Splits one idea into three "senses", buries the key point for your line (君なりの正当性 = "your own so-called justification"), and contradicts itself: it lists なり after adjectives and verbs as a pattern, then lists "attaching it to a verb" as a common mistake. |
| とおり | Grammar ("～とおり, just as"), not a noun guide. |
| もの | The line uses the pattern **X ものは X** ("what's impossible is impossible"); the guide is about もの in general. |
| 的 | Suffix ～的 ("-ish, -like, in the role of"); マドンナ的存在 deserves the grammar treatment. |
| では | The line has **じゃ** = では (contrast: "going by looks"). Fine content, wrong label; should be the では / じゃ contrast form. |

## C. Real errors

| Guide | Error |
|---|---|
| こと | Says the こと in ことビルカー投資銀行の…殺害に関しては is "probably not the word こと… a garbled subtitle". It isn't garbled: **こと + noun + に関しては** is a set pattern, "when it comes to X specifically (unlike the other cases)". The guide gets the line wrong. |
| particle_ni (built-in) | Attached to に関しては, where に is part of the compound particle; the に guide doesn't explain that. Should point to に関して. |

## D. Duplicates (merge; caused by the same form getting different names before 0.1.8)

- copula_da and copula_da_desu (だ / だった / です)
- explanatory_no_da, explanatory_n_da (built-in) and ending_no (のか in っていうのか): all explanatory の / んだ
- concessive_temo and te_mo_even_if (～ても / ～たって)
- quotation_to_tte and particle_tte (quoting って)

## E. Old style: romaji and no furigana

Written before the furigana rule: romaji in brackets (頑張って (ganbatte), 食べても (tabete mo)) and no
furigana markup. Rewrite in the current style:

te_form (頑張って), particle_wa, copula_da, darou, explanatory_no_da, concessive_temo,
adjective_ku_adverbial. (te_form and particle_wa also hide the newer built-in guides of the same name.)

Without furigana markup (no romaji): word guides その, みんな, もの, 旅行, 時, 産院, 男性, 診察, 順調, 頑張る,
and the grammar guide particle_no. Add furigana.

## F. Names (shouldn't have full guides)

イルザ, ハンス, ゲオルグ, シューバルト: about 4,000 characters each on a name. Replace with a one-line name entry.
(ギムナジウム and マドンナ are real words and are fine.)

## G. Fine, low value

うん, その, あなた, 人, 一つ, 16, 歳: correct but long for very basic words. Keep; the new "length scales with
how much there is to say" rule will stop this happening.

## H. Missing guides (from your questions and this audit)

- Clauses that describe a noun (殺した連中, 要らない連中, 吸血鬼を取り巻くコウモリ)
- こと + noun + に関しては
- In docs/pending-notes.md: 店を出す, 歯切れが悪い, に関して, なり (rewrite), 程度 / でしかない notes

## What happens next

Rewrites are written in the current guide style (furigana, no romaji, lead with your line, core idea in
one sentence), saved under the right name (phrase or grammar form), and loaded into your Library by the
build. Old versions are kept so any rewrite can be undone. Duplicates are merged into one guide each.
Your question notes are attached to the matching guides.
