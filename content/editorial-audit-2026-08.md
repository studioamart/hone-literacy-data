# Editorial and factual audit — August 2026

## Scope and method

This audit began as a read-only review of the 286 pre-year-pack passages (1,156 questions) and the completed 365-passage year pack (1,460 questions). The repository changed during the review: the year pack was merged into `data/passages.json`, the file version advanced from 11 to 12, and the release candidate applied the prioritized corrections described below. Findings identify passages by stable ID and preserve the original rationale for each repair.

Automated triage checked answer indices, option-length imbalance, paragraph references in explanations, lexical and sentence-length outliers, exact and semantic topic duplication, and age-sensitive vocabulary. Every finding retained below was then checked against its complete passage and questions. External facts were checked against the linked authoritative or scholarly sources. This is a risk-focused editorial audit, not a line-by-line scholarly citation apparatus for every otherwise plausible sentence.

Priority meanings:

- **P0 — correct before release:** materially false/outdated instruction or an assessment explanation that points to nonexistent evidence.
- **P1 — resolve before broad all-ages release:** culturally misleading framing, direct content duplication, or content that needs an age gate.
- **P2 — scheduled editorial improvement:** readability, overprecision, weak assessment construction, or lower-risk framing.

## Executive result

No invalid answer index was found, and manual review did not establish a case where a year-pack question's keyed option is itself wrong. The most urgent assessment defects are **13 incorrect paragraph locators in year-pack explanations**. The legacy cohort has several questions whose keys faithfully repeat a materially false or overconfident passage claim; those need passage and question changes together, not merely a new answer index.

The strongest release blockers are the two ice-density passages, the microwave and password passages, the outdated ice-core date, the overconfident fungal-network lesson, the greenhouse zero-emissions claim, and incomplete histories of printing and the Irish Famine. The year pack is substantially stronger factually and culturally than the legacy cohort; its main issues are repeated premises, explanation locators, and one Abu Simbel entry that celebrates monument rescue without acknowledging the Nubian displacement caused by the same dam project.

## Release disposition

All P0 and P1 items selected as v12 release blockers were resolved before the
manifest was generated:

- all 13 year-pack paragraph locators and the day-350 prose defect were fixed;
- the five strongest duplicated year-pack premises were replaced, and day 302
  was retitled and reframed to include Nubian displacement;
- 16 legacy factual/scientific repairs and 11 history, biography, and all-ages
  repairs were applied as complete passage/question/lesson replacements;
- the trolley scenario became a nonviolent art-kit allocation dilemma,
  Sarajevo was contextualized and made nongraphic, Jenner/Phipps now includes
  ethics and collective eradication history, and Aesop became an explicitly
  attributed modern nonfatal adaptation; and
- the 11 history/suitability replacements use a reviewed non-patterned answer
  layout, with no correct option uniquely longest across their 44 questions.

The remaining legacy topic clusters and broad P2 readability/option-length work
are documented editorial debt, not schema or factual release blockers. The
final corpus passes the strict audit with zero errors and zero warnings and the
app-compatible Swift decoder with 651 passages and 2,616 questions.

## P0: factual and assessment corrections

| Passage / question | Problem | Recommended change |
|---|---|---|
| `og-sci-why-ice-floats`, opening and `q3`; `og-sci2-why-ice-floats`, opening and `q3` | Both say solids become “heavier” when cooling. Mass does not increase; density commonly increases. `q3` in each passage assesses the resulting misconception. | Say that many substances contract and become **denser** on freezing, so their solid is denser than their own liquid. Rewrite `q3` and its explanation around density, not weight. Keep only one of these near-duplicate lessons. |
| `og-l2-why-the-plate-stays-cool`, `q1` and `q2` | “A microwave heats almost nothing except water” and the keyed prediction that a completely dry cracker stays cool are false. Microwave energy is also readily absorbed by fats and sugars; dry foods and some vessels can heat. | Rewrite the mechanism with water, fats, sugars, dielectric properties, and heat conducted from food. Replace the dry-cracker inference. [USDA microwave guidance](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/cooking-microwave-ovens). |
| `og-l2-why-passwords-got-longer`, `q1` and `q2` | “Eight characters fall in hours, whatever symbols” is not universally true; attack rate depends on randomness, hashing, hardware, and whether the attack is online or offline. “Length compounds; complexity does not” is mathematically false: a larger alphabet also expands the search space. | Teach current guidance instead: unique, long passwords/passphrases; password manager; MFA/passkeys; no universal cracking time. Replace `q2` with a question about why no fixed cracking time can be promised. [NIST password guidance](https://www.nist.gov/cybersecurity-and-privacy/how-do-i-create-good-password). |
| `og-sci2-air-from-another-age`, paragraph 2 and `q2` | “The deepest cores yet raised” reaching about 800,000 years is outdated. The Beyond EPICA core reached ice at least 1.2 million years old in 2025. | Update the range and rewrite `q2`/choices/explanation, or date the claim explicitly to the earlier EPICA record. [Beyond EPICA](https://www.beyondepica.eu/en/). |
| `og-sci-forest-fungal-network`, `q1`, `q3`, `q4` | It presents healthy trees sending spare sugar to shaded neighbors and “warning signals” through a forest web as established, purposeful sharing. Evidence for widespread beneficial transfer and signaling is contested and popular accounts have overinterpreted results. | Replace with the cautious treatment already modeled by `og-nat2-the-trade-under-the-forest`: fungal-tree exchange is well established; network prevalence, net benefit, direction, and “sharing” meanings are unsettled. Rebuild all three questions. [Nature Ecology & Evolution review](https://www.nature.com/articles/s41559-023-01986-1). |
| `og-sci-greenhouse-effect`, final paragraph and `q1` | It says warming already set in motion “will continue even if emissions were to stop tomorrow,” attributing this to ocean lag. Current IPCC guidance is that sustained global net-zero CO2 approximately stabilizes CO2-induced warming; non-CO2 forcers and the precise zero-emissions scenario matter. | Distinguish **emissions reductions** from **net-zero CO2**, and temperature stabilization from the long persistence of sea-level rise and other impacts. Replace `q1`, whose keyed answer repeats the misleading lag claim. [IPCC AR6 FAQ 3.1](https://www.ipcc.ch/report/ar6/wg3/downloads/faqs/IPCC_AR6_WGIII_FAQ_Chapter_03.pdf). |
| `og-non-placebo-effect`, paragraph 3 and `q3` | If a drug group merely matches a placebo group, “belief alone” is not the only explanation. Placebo-group change also includes natural history, regression toward the mean, reporting effects, and trial context. | Say the comparison estimates the treatment's incremental effect over everything shared by groups. Replace `q3` and its explanation. `og-sci2-the-sugar-pill-problem` is the more accurate existing treatment. [Cochrane review](https://www.cochrane.org/evidence/CD003974_placebo-interventions-all-clinical-conditions). |
| `og-non-decision-fatigue`, all paragraphs; `q1`, `q2`, `q4` | A finite reservoir of “mental energy” depleted by choices is presented as settled mechanism. Evidence is mixed, and a large preregistered field study found no domain-general decision-fatigue effect in its setting. | Either replace the lesson or explicitly teach it as a debated hypothesis, separate it from ordinary tiredness, and remove the fuel/reservoir mechanism. Rebuild the questions. [2025 registered report](https://www.nature.com/articles/s44271-025-00207-8). |
| `og-his-printing-press`, opening and `q2` | “Long ago, every book had to be copied by hand” is false and the keyed answer repeats it. East Asian woodblock printing preceded Gutenberg by centuries; movable type appeared in China, and movable metal type in Korea, before Gutenberg's European press. | Scope the passage to Gutenberg's printing system and its effects in Europe. Replace `q2` with a comparative or scoped detail question. [UNESCO East Asian printing history](https://en.unesco.org/silkroad/content/did-you-know-invention-and-transfusion-printing-technology-east-asia-and-its-implications), [UNESCO on Korean metal type](https://www.unesco.org/en/articles/200-years-gutenberg-master-printers-koryo-0). |
| `og-sci-coral-reef`, “reefs grow only in clear, sunlit waters” | The claim is only defensible for the shallow, photosymbiotic reef builders being described. Deep-sea corals live without sunlight, and some form reef structures. | Change to “many shallow tropical reefs” and explicitly scope the algae partnership. Questions can remain after that scope is clear. [NOAA deep-sea coral habitat](https://www.fisheries.noaa.gov/national/habitat-conservation/deep-sea-coral-habitat). |
| `og-sci-moon-tides`, opening | “Twice a day” is overgeneralized. Most coasts have two highs and lows, but some have one and others have mixed patterns; the simple equilibrium bulge model does not by itself predict local timing. | Open with “At most coasts” and add one sentence about continents, seafloor, and local patterns. [NOAA tidal patterns](https://oceanservice.noaa.gov/facts/high-tide.html). |
| `og-non-path-dependence`, paragraph 1 and `q2` | The “QWERTY separated frequently paired letters to prevent jams” origin story is presented as settled, as is the premise that a faster layout necessarily exists. Both are historically disputed/underspecified. | Use a less contested standard-lock-in example, or qualify the QWERTY story as one debated explanation and remove `q2` as a factual recall item. |

### P0 year-pack explanation locators

In every row below the keyed option is supported by the passage, but the explanation names the wrong paragraph. These are safe copy changes.

| Passage / question | Current locator | Correct locator / action |
|---|---|---|
| `og-y26-d186-henrietta-leavitt-star-yardstick/q4` | “first paragraph” calls the stars “variables” | The exact term “variable stars” occurs in paragraph 2; alternatively cite the definition in paragraph 1 without claiming the exact plural noun. |
| `og-y26-d275-getting-used-to-good-news/q4` | fourth | third |
| `og-y26-d294-edmonia-lewis-carves-her-own-path/q4` | second | first |
| `og-y26-d300-the-satellite-that-watches-crops/q4` | fourth | third (clouds hide the ground); clouds are also listed in paragraph 2 as a confound. |
| `og-y26-d304-what-a-cooper-builds/q4` | third | second |
| `og-y26-d305-the-tunnel-through-a-barrier/q4` | fourth | third |
| `og-y26-d314-the-lighthouse-keeper-s-logbook/q4` | second | first |
| `og-y26-d321-the-kite-with-two-tails/q4` | fourth | third |
| `og-y26-d337-the-paper-crane-on-the-bus/q4` | second | first |
| `og-y26-d340-the-chain-of-custody-behind-an-artifact/q4` | third and mentions unpresented “packaging” | second; remove “packaging.” |
| `og-y26-d343-the-farmer-s-choice-before-rain/q4` | third | second |
| `og-y26-d350-the-airlift-that-fed-a-blockaded-city/q4` | fifth (the passage has four paragraphs) | third |
| `og-y26-d354-bayard-rustin-plans-the-march/q4` | third | second |

Also fix the independent prose typo in `og-y26-d350-the-airlift-that-fed-a-blockaded-city`: “kept an **extremely confrontation** below war” should be “kept an **extreme confrontation** below the threshold of war,” or similar.

## P1: history, biography, and cultural framing

| Passage | Problem | Recommended change |
|---|---|---|
| `og-his2-the-potato-in-europe`, especially `q1` and `q3` | The Great Irish Famine is reduced to genetic narrowness and plant disease: “one reliable food” became a single point of failure. It omits colonial land/economic structures, British policy and relief failures, and continued food exports. The main-idea key makes the omission the lesson. | Rewrite the Ireland section as a multi-causal catastrophe. Keep blight and dependency, but include landholding, poverty, exports, and state response; rebuild `q1` and `q3`. [UK Parliament overview](https://www.parliament.uk/about/living-heritage/evolutionofparliament/legislativescrutiny/parliamentandireland/overview/the-great-famine/), [Queen's University Belfast review](https://pure.qub.ac.uk/en/publications/was-the-great-irish-famine-a-colonial-famine/). |
| `og-y26-d302-the-village-that-moved-a-temple` | The title is false—the passage describes moving temples, not a village—and the engineering triumph is detached from the displacement of Nubian towns and villages caused by the dam projects. | At minimum retitle to “The Temples Moved to Higher Ground.” Prefer adding a proportionate sentence that monument rescue occurred alongside large human resettlement and loss of place. [UNESCO monument campaign](https://whc.unesco.org/en/activities/172), [UNESCO historical account noting Nubian towns and villages moved](https://unesdoc.unesco.org/in/documentViewer.xhtml?ark=%2Fark%3A%2F48223%2Fpf0000074755%2FPDF%2F074755engo.pdf). |
| `og-his-great-wall`, `q1` and `q4` | “Invaders from the north” versus a single timeless “China” turns many dynasties, frontier polities, pastoral peoples, trade relationships, and internal wall building into a civilizational binary. `q1` repeats it as gist. | Name a specific dynasty or teach the walls as changing frontier systems used for defense, signaling, movement/control, and trade. Name relevant neighboring polities where possible. [Peking University lecture summary](https://english.pku.edu.cn/events/10146.html), [Indiana University Press history](https://iupress.org/9780253331878/peace-war-and-trade-along-the-great-wall/). |
| `og-his-library-alexandria`, final paragraph and `q1` | “Where anyone who seeks it can find it” and a direct modern public-library lineage overstate uncertain access and flatten the royal Mouseion/scholarly institution into a modern public library. | Retain collecting, cataloging, scholarship, and uncertain decline; frame modern influence as analogy, not direct democratic inheritance. Rebuild `q1`. [University of Chicago Library](https://www.lib.uchicago.edu/about/news/the-library-of-alexandria/), [Harvard Center for Hellenic Studies](https://chs.harvard.edu/annotation/the-libraries-of-alexandria-and-pergamon-as-classical-models-7/). |
| `og-his-coffeehouse`, “almost anyone” and `q3` | The passage universalizes a European/London “open public sphere” while omitting gender and class exclusions. Women were largely excluded or marginalized in the English coffeehouse debate culture. | Scope place and period, replace “almost anyone,” and include who could not participate on equal terms. Retain exchange-of-ideas thesis with that limit. [Oxford history of the public sphere](https://academic.oup.com/hwj/article-abstract/51/1/127/706434), [Oxford History of Science, London](https://newtonandthemint.history.ox.ac.uk/newtons-london/science-in-london). |
| `og-his-roman-roads`, “the roads helped everyone” and `q3` | The account treats imperial military mobility and “keeping order” as neutral public benefit and calls all subjects “everyone.” Roads also enabled conquest, coercion, taxation, and extraction. | Replace the universal benefit claim with a balanced account: military control first, alongside trade/travel benefits that varied by user and status. Revise the gist option. |
| `og-his-printing-vaccine`, `q1` | The narrative names an anonymous “healthy boy,” omits that James Phipps was eight and could not give modern informed consent, and credits Jenner's observation with “eventually ending” smallpox. It also omits earlier variolation in Asia and Africa and the collective global eradication campaign. | Name Phipps and Sarah Nelmes; state the ethical problem plainly; distinguish the first successful vaccine demonstration from earlier variolation and later worldwide surveillance/vaccination programs. Rebuild `q1`. [WHO vaccination history](https://www.who.int/news-room/spotlight/history-of-vaccination/history-of-smallpox-vaccination). |
| `og-bio2-humboldt-web-of-nature` | “European science mostly collected” creates a lone-genius contrast and the passage does not acknowledge Indigenous/local expertise and colonial access that supported Humboldt's work. | Qualify the opening; source and credit collaborators and knowledge holders relevant to the examples. Keep his systems insight and anti-plantation observation. |
| `og-bio2-sequoyah-writes-cherokee`, title and `q1` wording | “Writes a Language” can imply Sequoyah created Cherokee rather than a syllabary for an existing language. | Safe retitle: “Sequoyah Creates a Cherokee Syllabary.” Change `q1` correct option to the same precise wording. |

## P1: suitability for an app labeled 4+ / all ages

These are not claims that children can never encounter death or difficult history. They are mismatches between an unqualified **4+** label and material requiring developmental context. A product-level age/content-tag policy would avoid arbitrary passage-by-passage censorship.

| Passage | Concern | Recommended change |
|---|---|---|
| `og-phi-the-trolley-problem` | Repeatedly depicts people tied to tracks, five deaths, pushing a stranger to his death, killing “by your hand,” and murder. | Exclude from the 4+ pool; place behind an older-reader ethics tag, or replace the physical-harm stakes with a developmentally appropriate allocation dilemma. |
| `og-l4-wrong-turn-in-sarajevo` | Graphic sequence includes a bomb, wounded passengers, and shooting and killing Franz Ferdinand and Sophie. | Older-reader history tag; if retained broadly, reduce scene detail and add context so assassination is not merely a suspense device. |
| `og-his-printing-vaccine` | An adult deliberately infects an eight-year-old with cowpox and then exposes him to smallpox, without consent/ethics framing. | Older-reader tag and the historical/ethical rewrite described above. |
| `pd-aesop-ant-grasshopper` (Level 1) | Ends with the Grasshopper “dying of hunger”; `q1` explanation intensifies it to “starves.” Its archaic diction also makes it poor early-reader material. | Use a modern, nonfatal adaptation for Level 1, or move the public-domain original to a higher, tagged collection. |

## P1: direct duplicate topics and premises

Duplication is not inherently wrong if the product intentionally offers leveled variants. These pairs/clusters are close enough that the catalog should either label them as variants or replace the weaker entry. Unmarked repetition weakens a “year of new readings” promise.

### Year-pack replacements or deliberate differentiations

| IDs | Overlap | Recommendation |
|---|---|---|
| `og-y26-d024-the-quiet-work-of-error-correction` + `og-y26-d180-message-repairs-missing-bit` | Same structured-redundancy/check-bit explanation, including cost and limits. | Keep the clearer age-appropriate entry; replace the other topic, or make one exclusively parity and one a real-world case study. |
| `og-y26-d031-the-lighthouse-everyone-can-use` + `og-y26-d139-lamp-everyone-uses` | Same nonrival/non-excludable light example for public goods. | Replace one; changing lighthouse to streetlamp does not materially change the lesson. |
| `og-y26-d124-library-for-tools` + `og-y26-d163-drill-on-the-shared-shelf` | Same tool-library/drill premise, access-versus-ownership benefit, and management costs. | Replace one or make one a narrative operational case and the other a genuinely different sharing model. |
| `og-y26-d190-two-explanations-one-shadow` + `og-y26-d274-two-explanations-one-set-of-facts` | Same underdetermination lesson: one observation fits rival causes; seek discriminating evidence. | Replace one with a different philosophical problem. |
| `og-y26-d206-when-ships-read-flags` + `og-y26-d352-the-signal-flags-in-a-harbor` | Same standardized maritime signal-flag code, language bridge, and visibility limits. | Replace one; these are direct leveled variants without variant labeling. |
| `og-y26-d123-courtyard-after-sunset` + `og-y26-d303-the-moonflower-and-its-night-visitor` | Both center pale, scented night flowers and moth pollination. | Lower priority than the five pairs above: retain only if the broader urban habitat versus flower specialization distinction is intentional and visible in catalog metadata. |

### Legacy clusters

Strongest clusters are:

- sunk cost: `og-non-sunk-cost`, `og-eco-sunk-cost`;
- lichen partnership: `og-sci2-two-lives-one-body`, `og-nat2-two-lives-in-one`, plus year entry `og-y26-d003-a-lichen-is-two-lives`;
- veil of ignorance: `og-phi-the-veil-of-ignorance`, `og-phi2-choosing-behind-a-veil`;
- ice density: `og-sci-why-ice-floats`, `og-sci2-why-ice-floats`;
- Rosetta Stone: `og-his-rosetta-stone`, `og-his2-the-rosetta-stone`;
- map projection: `og-non-mercator-map`, `og-esy2-every-map-is-wrong`;
- placebo: `og-non-placebo-effect`, `og-psy2-the-honest-placebo`, `og-sci2-the-sugar-pill-problem`;
- Ship of Theseus: `og-phi-ship-of-theseus`, `og-phi2-the-ship-that-was-rebuilt`;
- sky color/Rayleigh scattering: `og-sci-why-sky-blue`, `og-sci2-the-colour-of-air`;
- comparative advantage: `og-non-comparative-advantage`, `og-eco-comparative-advantage`, `og-eco2-two-tasks-one-worker`;
- railway standard time: `og-his-standard-time`, `og-his2-railway-time`;
- spacing effect: `og-non-spacing-effect`, `og-psy2-spacing-your-study`;
- bystander effect: `og-non-bystander-effect`, `og-psy2-the-quiet-crowd`;
- sleep and consolidation: `og-how-memory-consolidates`, `og-l12-why-we-sleep`, `og-psy2-what-sleep-does-with-learning`, `og-sci2-what-sleep-does`.

The later duplicate titles have already been made unique in the in-progress merged corpus (`og-fic2-the-understudy` → “The Cost of Perfect Readiness”; `og-sci2-why-ice-floats` → “The Lake’s Winter Lid”), but title changes do not resolve substantive duplication.

## P2: level and fluency outliers

Sentence triage used a simple tokenizer and is diagnostic, not a replacement for child testing. Medians in the current merged set are about 10.5 words/sentence at Level 1, 12.4 at Level 2, 14.0 at Level 3, 14.4 at Level 4, and 14.3 at Level 5.

| Passage | Signal | Recommendation |
|---|---|---|
| `pd-aesop-ant-grasshopper` (L1) | 16.7 words/sentence average, 35-word maximum; archaic “toiling and moiling”; fatal ending. | Modernize and retest as L2, or exclude from timed early fluency. |
| `og-l1-why-the-big-box-costs-less` (L1) | 184 words, 14.2 words/sentence average, 28-word maximum; pricing/economies-of-scale abstraction. | Move to L2 or shorten and concretize. |
| `og-y26-d186-henrietta-leavitt-star-yardstick` (L1) | Highest average word length among L1 items; requires “Small Magellanic Cloud,” “Cepheid variables,” calibration, true/apparent brightness. | Move to at least L2 or simplify vocabulary and concept load. |
| `og-y26-d102-charles-drew-builds-a-blood-bank` (L2) | Highest average word length among L2 items; plasma, transfusion, preservation, segregation, coordinated systems. | Move to L3 or simplify syntax/technical density. |
| `og-deep-vs-shallow-reading` and `og-l2-why-passwords-got-longer` (L2) | 35- and 32-word maximum sentences respectively; abstract argumentation. | Relevel to L3 after factual repair, or split sentences. |
| `og-ess-small-courage`, `og-phi-the-uses-of-boredom`, `og-fic-snow-day` (L3) | 20.6–22.7 words/sentence averages versus L3 median 14.0; maximums 32–35. | Sentence-level edit or move to L4. |
| `pd-twain-mississippi` (L4) | 34.2 words/sentence average, 46-word maximum; period syntax. | Move to L5 and mark as historical prose. |
| `pd-darwin-entangled-bank`, `pd-plato-cave` (L5) | 46.3/33.7 words per sentence average and 66/55-word maxima; substantially harder than modern L5 median. | Keep only as explicitly “challenge/classic” material; do not use in ordinary timed fluency without annotation or edited excerpts. |

## P2: weak main-idea construction and other overprecision

- `og-his-library-alexandria/q1`, `og-his-great-wall/q1`, and `og-his-printing-vaccine/q1` are not merely long correct options; their gist choices encode the disputed framing described above and must be rebuilt with the passage.
- `og-nat2-the-terns-long-year/q1` says “longest journey of any animal.” The claim is supportable as the longest **known annual migration**, but “known” should appear in the passage and option. [British Antarctic Survey](https://www.bas.ac.uk/data/our-data/publication/tracking-of-arctic-terns-sterna-paradisaea-reveals-longest-animal-migration/).
- Main-idea keys are frequently much longer and more qualified than distractors. In the 286 pre-year-pack passages, 226 of 286 keyed gist options are at least 1.5 times the mean distractor length and 80 are at least twice as long. The year pack improves this (196/365 and 12/365), but the cue remains systematic. High examples include `og-l3-why-the-wait-feels-long/q1`, `og-non-moral-hazard/q1`, `og-nat2-honest-liars/q1`, `og-non-bystander-effect/q1`, and `og-his-printing-vaccine/q1`. Shorten the key or enrich plausible distractors; do not make “longest and most nuanced” a test-taking strategy.
- `og-l3-a-sheet-that-keeps-its-shape` says a halved A4 sheet has “exactly” the same shape and A0 covers “exactly” one square meter. The mathematical ISO series is defined from those ideals, but nominal millimeter dimensions are rounded. Replace “exactly” with “approximately” when discussing physical sheets, or explicitly distinguish the ideal definition from manufactured dimensions.
- `og-eco2-sharing-the-risk` opens with “A fire destroys about one house in a thousand each year” without a jurisdiction, period, peril definition, or citation. Mark it as a hypothetical numerical illustration rather than a global rate.
- `og-l1-why-we-shiver` says the body holds one temperature near 37°C “all day.” Normal temperature varies with time, person, activity, and measurement site. Use a healthy range and preserve the shivering mechanism.

## Safe fixes versus changes needing judgment

### Safe, deterministic fixes

These do not require a new factual thesis or stakeholder decision:

1. Correct the 13 year-pack explanation locators listed above.
2. Fix `og-y26-d350-the-airlift-that-fed-a-blockaded-city`'s “extremely confrontation” typo.
3. Retitle `og-y26-d302-the-village-that-moved-a-temple` to describe the temples, and retitle `og-bio2-sequoyah-writes-cherokee` to name the Cherokee syllabary; update directly dependent gist wording.
4. Replace “heavier” with “denser” in the two ice passages **only as part of** rebuilding their dependent `q3`s.
5. Scope “reefs” to shallow photosymbiotic reef builders and “twice a day” to most coasts.
6. Mark the insurance fire rate as hypothetical and change physical A-series “exactly” claims to approximate/ideal-definition wording.
7. Relevel or sentence-edit the objective readability outliers after a single consistent house rule is chosen.

### Requires sourcing or editorial/product judgment

1. Rewrite printing, the Irish Famine, Great Wall/frontier history, coffeehouses, Alexandria, Jenner/Phipps, Humboldt, and Abu Simbel/Nubian displacement with subject-matter review. These are not safe one-sentence insertions: emphasis and whose perspective is centered matter.
2. Replace or substantially reframe the password, microwave, climate-lag, placebo, decision-fatigue, fungal-network, and QWERTY lessons. Their questions are coupled to the current claims.
3. Decide whether close duplicates are intentional leveled variants. If yes, add explicit variant/family metadata and sequencing rules; if no, replace the weaker member rather than merely retitling it.
4. Define the product's “4+” promise: universal availability, App Store rating only, or a true developmental reading pool. Apply content tags/age gates consistently after that decision.
5. Rebalance main-idea distractors using an assessment style guide and learner testing; mechanical equal-length editing can make choices unnatural or introduce new ambiguity.

## Recommended release order

1. Apply and test the 13 explanation-locator fixes and the day-350 typo.
2. Block or repair the P0 factual lessons and every question that depends on them.
3. Resolve the three 4+ suitability passages before presenting the corpus as unqualified all-ages content.
4. Replace/differentiate the five strongest year-pack duplicate pairs before finalizing the OTA manifest.
5. Commission the culturally sensitive history rewrites with sources and, where practical, reviewers connected to the communities represented.
6. Run readability and option-length QA as a scheduled second editorial pass; neither should delay correction of factual errors.
