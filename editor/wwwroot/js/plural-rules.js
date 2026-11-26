// The editor's own plural rules, used for new files and to detect files whose
// Plural-Forms header is outdated.
//
// They are the integer rules of Unicode CLDR 49
// (https://www.unicode.org/cldr/charts/49/supplemental/language_plural_rules.html),
// written with the same form indexes as Orchard Core's DefaultPluralRuleProvider
// (src/OrchardCore/OrchardCore.Localization.Core/DefaultPluralRuleProvider.cs). Forms
// CLDR added later are appended, so the indexes of older rules keep their meaning.
//
// Existing files keep working with the rule of their header: Orchard Core and Crowdin
// both read it. Updating a file to the rule below is an explicit, reviewable change.

const RULES = [
  [['ay', 'bm', 'bo', 'dz', 'hnj', 'id', 'ig', 'ii', 'in', 'ja', 'jbo', 'jv', 'jw', 'kde', 'kea', 'km', 'ko', 'lkt', 'lo', 'ms', 'my', 'nqo', 'osa', 'sah', 'ses', 'sg', 'su', 'th', 'to', 'tpi', 'tt', 'wo', 'yo', 'yue', 'zh'],
    'nplurals=1; plural=0;'],
  [['ach', 'ak', 'am', 'arn', 'as', 'bho', 'bn', 'csw', 'doi', 'fa', 'ff', 'gu', 'gun', 'guw', 'hi', 'hy', 'kab', 'kn', 'kok', 'kok-Latn', 'ln', 'mfe', 'mg', 'mi', 'nso', 'oc', 'pa', 'pcm', 'si', 'tg', 'ti', 'vi', 'wa', 'zu'],
    'nplurals=2; plural=(n > 1);'],
  [['af', 'an', 'anp', 'asa', 'ast', 'az', 'bal', 'bem', 'bez', 'bg', 'brx', 'ce', 'cgg', 'chr', 'ckb', 'da', 'de', 'dv', 'ee', 'el', 'en', 'eo', 'et', 'eu', 'fi', 'fo', 'fur', 'fy', 'gsw', 'ha', 'haw', 'hne', 'hu', 'ia', 'ie', 'io', 'jgo', 'ji', 'jmc', 'ka', 'kaj', 'kcg', 'kk', 'kkj', 'kl', 'ks', 'ksb', 'ku', 'ky', 'lb', 'lg', 'lij', 'mai', 'mas', 'mgo', 'ml', 'mn', 'mni', 'mr', 'nah', 'nap', 'nb', 'nd', 'ne', 'nl', 'nn', 'nnh', 'no', 'nr', 'ny', 'nyn', 'om', 'or', 'os', 'pap', 'pms', 'ps', 'rm', 'rof', 'rw', 'rwk', 'saq', 'sc', 'sco', 'sd', 'sdh', 'seh', 'sn', 'so', 'son', 'sq', 'ss', 'ssy', 'st', 'sv', 'sw', 'syr', 'ta', 'te', 'teo', 'tig', 'tk', 'tn', 'tr', 'ts', 'ug', 'ur', 'uz', 've', 'vo', 'vun', 'wae', 'xh', 'xog', 'yi'],
    'nplurals=2; plural=(n != 1);'],
  [['tzm'], 'nplurals=2; plural=(n <= 1 || (n >= 11 && n <= 99) ? 0 : 1);'],
  [['fr', 'pt', 'pt-BR'], 'nplurals=3; plural=(n == 0 || n == 1 ? 0 : n % 1000000 == 0 ? 2 : 1);'],
  [['ca', 'es', 'es-AR', 'gl', 'it', 'lld', 'pt-PT', 'scn', 'vec'], 'nplurals=3; plural=(n == 1 ? 0 : n != 0 && n % 1000000 == 0 ? 2 : 1);'],
  [['is'], 'nplurals=2; plural=(n % 10 != 1 || n % 100 == 11);'],
  [['mk'], 'nplurals=2; plural=(n % 10 == 1 && n % 100 != 11 ? 0 : 1);'],
  [['ceb', 'fil', 'tl'], 'nplurals=2; plural=(n % 10 == 4 || n % 10 == 6 || n % 10 == 9);'],
  [['be', 'bs', 'hr', 'ru', 'sh', 'sr', 'uk'], 'nplurals=3; plural=(n % 10 == 1 && n % 100 != 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2);'],
  [['lt'], 'nplurals=3; plural=(n % 10 == 1 && (n % 100 < 11 || n % 100 > 19) ? 0 : n % 10 >= 2 && (n % 100 < 11 || n % 100 > 19) ? 1 : 2);'],
  [['cs', 'sk'], 'nplurals=3; plural=(n == 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2);'],
  [['csb', 'pl'], 'nplurals=3; plural=(n == 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2);'],
  [['lv', 'prg'], 'nplurals=3; plural=(n % 10 == 0 || (n % 100 >= 11 && n % 100 <= 19) ? 2 : n % 10 == 1 ? 0 : 1);'],
  [['blo', 'cv', 'ksh', 'lag', 'mnk'], 'nplurals=3; plural=(n == 0 ? 0 : n == 1 ? 1 : 2);'],
  [['he', 'iu', 'iw', 'naq', 'sat', 'se', 'sma', 'smi', 'smj', 'smn', 'sms'], 'nplurals=3; plural=(n == 1 ? 0 : n == 2 ? 2 : 1);'],
  [['shi'], 'nplurals=3; plural=(n <= 1 ? 0 : n <= 10 ? 1 : 2);'],
  [['mo', 'ro'], 'nplurals=3; plural=(n == 1 ? 0 : n == 0 || (n % 100 > 0 && n % 100 < 20) ? 1 : 2);'],
  [['cy'], 'nplurals=6; plural=(n == 0 ? 4 : n == 1 ? 0 : n == 2 ? 1 : n == 3 ? 2 : n == 6 ? 5 : 3);'],
  [['gd'], 'nplurals=4; plural=(n == 1 || n == 11 ? 0 : n == 2 || n == 12 ? 1 : n > 2 && n < 20 ? 2 : 3);'],
  [['kw'], 'nplurals=6; plural=(n == 0 ? 4 : n == 1 ? 0'
    + ' : n % 100 == 2 || n % 100 == 22 || n % 100 == 42 || n % 100 == 62 || n % 100 == 82'
    + ' || (n % 1000 == 0 && ((n % 100000 >= 1000 && n % 100000 <= 20000) || n % 100000 == 40000 || n % 100000 == 60000 || n % 100000 == 80000))'
    + ' || n % 1000000 == 100000 ? 1'
    + ' : n % 100 == 3 || n % 100 == 23 || n % 100 == 43 || n % 100 == 63 || n % 100 == 83 ? 2'
    + ' : n % 100 == 1 || n % 100 == 21 || n % 100 == 41 || n % 100 == 61 || n % 100 == 81 ? 5 : 3);'],
  [['mt'], 'nplurals=5; plural=(n == 1 ? 0 : n == 2 ? 4 : n == 0 || (n % 100 >= 3 && n % 100 <= 10) ? 1 : n % 100 >= 11 && n % 100 <= 19 ? 2 : 3);'],
  [['dsb', 'hsb', 'sl'], 'nplurals=4; plural=(n % 100 == 1 ? 1 : n % 100 == 2 ? 2 : n % 100 == 3 || n % 100 == 4 ? 3 : 0);'],
  [['sgs'], 'nplurals=4; plural=(n % 10 == 1 && n % 100 != 11 ? 0 : n == 2 ? 1 : n % 10 >= 2 && (n % 100 < 11 || n % 100 > 19) ? 2 : 3);'],
  [['br'], 'nplurals=5; plural=(n % 10 == 1 && n % 100 != 11 && n % 100 != 71 && n % 100 != 91 ? 0'
    + ' : n % 10 == 2 && n % 100 != 12 && n % 100 != 72 && n % 100 != 92 ? 2'
    + ' : (n % 10 == 3 || n % 10 == 4 || n % 10 == 9) && (n % 100 < 10 || n % 100 > 19) && (n % 100 < 70 || n % 100 > 79) && (n % 100 < 90 || n % 100 > 99) ? 3'
    + ' : n != 0 && n % 1000000 == 0 ? 4 : 1);'],
  [['ga'], 'nplurals=5; plural=(n == 1 ? 0 : n == 2 ? 1 : n > 2 && n < 7 ? 2 : n > 6 && n < 11 ? 3 : 4);'],
  [['gv'], 'nplurals=4; plural=(n % 10 == 1 ? 0 : n % 10 == 2 ? 1 : n % 100 == 0 || n % 100 == 20 || n % 100 == 40 || n % 100 == 60 || n % 100 == 80 ? 2 : 3);'],
  [['ar', 'ars'], 'nplurals=6; plural=(n == 0 ? 0 : n == 1 ? 1 : n == 2 ? 2 : n % 100 >= 3 && n % 100 <= 10 ? 3 : n % 100 >= 11 ? 4 : 5);'],
];

const byCode = new Map();
for (const [codes, rule] of RULES) for (const code of codes) byCode.set(code.toLowerCase(), rule);

/** Every culture code with a rule, and its Plural-Forms value. */
export const pluralRules = () => new Map(RULES.flatMap(([codes, rule]) => codes.map((code) => [code, rule])));

/**
 * The Plural-Forms value for a culture ("fr", "pt-BR", "sr-Cyrl-RS", "zh_Hans"…), or
 * null when none is known. Like Orchard Core, a specific culture falls back to its
 * parents: "sr-Cyrl-RS", then "sr-Cyrl", then "sr".
 */
export function pluralRuleFor(culture) {
  const parts = String(culture ?? '').replace(/_/g, '-').toLowerCase().split('-').filter(Boolean);
  while (parts.length) {
    const rule = byCode.get(parts.join('-'));
    if (rule) return rule;
    parts.pop();
  }
  return null;
}
