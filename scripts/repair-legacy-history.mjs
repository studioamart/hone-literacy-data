#!/usr/bin/env node
/**
 * Apply the reviewed P1 history, biography, and all-ages suitability repairs.
 *
 * Each repair is a complete, stable-ID replacement of the passage, its four
 * questions, and its teaching lesson. The expected source digests describe the
 * post-normalization legacy corpus. For the one source touched by the paragraph
 * migration, the digest deliberately collapses blank-line layout so either the
 * original block or its reviewed paragraph-only repair is accepted.
 *
 * The migration is fail-closed: every target must be either the exact audited
 * source state or the exact replacement state. Unexpected edits, missing IDs,
 * schema drift, or ID/count changes abort without writing. By default the script
 * targets data/passages.json; use --dry-run and/or --input/--output for review.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = join(ROOT, 'data', 'passages.json');
const EXPECTED_LEGACY_COUNT = 286;
const YEAR_PACK_ID = /^og-y26-d\d{3}-/;
const QUESTION_SKILLS = new Set(['main-idea', 'detail', 'inference', 'vocabulary']);
const ORIGINAL_SOURCE = 'Written for Fluency';
const ORIGINAL_ATTRIBUTION = 'Original passage © Studio AM, written for Fluency.';

function question(id, skill, stem, choices, answer, explanation) {
  return { id, skill, stem, choices, answer, explanation };
}

function lesson(strategy, signals, vocab, skillTips) {
  return { strategy, signals, vocab, skillTips };
}

function signal(phrase, means) {
  return { phrase, means };
}

function vocab(word, inContext) {
  return { word, inContext };
}

// Digests cover every source passage field after collapsing blank-line layout.
// They were generated from the audited, normalized legacy cohort, after the
// reviewed lesson cleanup. Paragraph-only changes therefore cannot conceal
// prose changes, but the dedicated paragraph migration may safely run first.
const EXPECTED_SOURCE_DIGESTS = new Map([
  ['og-his2-the-potato-in-europe', 'b32fe83535d14dad366788a5e568ba4b5d05de0f245cf2f6299b9f6099ee5472'],
  ['og-his-great-wall', '0d0778956f5ea40c7c4806dd7c2c5317d5f296733aac887c7e823db2fd83222a'],
  ['og-his-library-alexandria', '656bfe22fa91954622e2cc859cedd4161633d20731942bbc6e5dcbb5021183fa'],
  ['og-his-coffeehouse', '6d1a795cfa9a4ce4542cb6baa65efc678864dfecc30c1babeb2be450c534aecd'],
  ['og-his-roman-roads', '89f49230b7af9059969e42ac06d0a1aeef482cc6ca02b161f82818882fab79a0'],
  ['og-his-printing-vaccine', '384faf415c5666abcbca722a95fa89a09762036f47b3231a47b3eb911fd6ef50'],
  ['og-bio2-humboldt-web-of-nature', '84c5332a9fcc5d05951019c2f3b1f669ad7d68634ea6b2b00075a2c4b55b3d42'],
  ['og-bio2-sequoyah-writes-cherokee', 'd0dfef42f503667a6680e6a6479ddd0110a3682a8a4ad5bfb6beaa1acc2cbade'],
  ['og-phi-the-trolley-problem', '0b06e64bd7852ed20b2202d87ef69adb8e2027bbdf35c01b27c335393c974732'],
  ['og-l4-wrong-turn-in-sarajevo', 'c6a725bf62f2f09327376fac76ba4d70f2e465118f6a418756190968db788adc'],
  ['pd-aesop-ant-grasshopper', 'dfbf4e2cf5e8cc64d6c59970719feb2d11c0ba5f80d0f7670b0d125ce6f81edb'],
]);

// Transitional state produced by the first reviewed P1 migration. These exact
// complete-object digests allow a safe second run to pick up the assessment and
// attribution refinements below. They are not paragraph-collapsed and therefore
// do not accept alternate metadata, extra fields, or any partial edit.
const EXPECTED_INTERMEDIATE_DIGESTS = new Map([
  ['og-his2-the-potato-in-europe', 'af92d31a80a25a3d1ad6a158ca7699409ef93196c323d1b835c0c9eb4004fb7f'],
  ['og-his-great-wall', 'f154915ec2cb8b1b89fa6262edd30d06183e29887d47f7a2df84693ca3b5f996'],
  ['og-his-library-alexandria', 'ed47d432e4ca8a23c07e9a50d93d955a41399386b7f21dce53fa67c3f14f208b'],
  ['og-his-coffeehouse', 'd2315f600d1c7db17db905a6685b36c4e7d1b17cc8a5b6263b7355fc193c4ab2'],
  ['og-his-roman-roads', 'ba6dff09e46c4613d02aee738665a4498eb040d5b47bf7eb3133ddd739333c8f'],
  ['og-his-printing-vaccine', 'faa329880175ab8dddab559e5ea3b27230d8c21681561f74440fc26d69ad7e9d'],
  ['og-bio2-humboldt-web-of-nature', 'cdaa869111283a8866cca00b031d53f36ad52994ca20a7e791d5053982bd6563'],
  ['og-bio2-sequoyah-writes-cherokee', '755ad370d9548b72e0bc74109a1e2a8956c6b27bb8da511eadef8c027fe60883'],
  ['og-phi-the-trolley-problem', 'c89cb97a4eac88871257f0c29ceaf2f4e14bdfecf1142a3d3ce6f2e5ac99ea39'],
  ['og-l4-wrong-turn-in-sarajevo', 'a52aa05e81b9c114e080586fc74f376e58b0caa656a5ea889d85fd6f79385a59'],
  ['pd-aesop-ant-grasshopper', '294206cad2a3ff0657dc82acd3ea434bb5226c8585aab04bda3121fb7154e445'],
]);

// Source links are review provenance only and are not added to the app schema.
// They mirror the audit's authoritative/scholarly references, supplemented for
// Roman roads, Humboldt, and Sequoyah where the audit requested sourced credit.
const REPAIRS = new Map([
  ['og-his2-the-potato-in-europe', {
    sources: [
      'https://www.parliament.uk/about/living-heritage/evolutionofparliament/legislativescrutiny/parliamentandireland/overview/the-great-famine/',
      'https://pure.qub.ac.uk/en/publications/was-the-great-irish-famine-a-colonial-famine/',
    ],
    replacement: {
      title: 'The Potato and the Great Irish Famine',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'history',
      level: 4,
      wordCount: -1,
      text: `Potatoes reached Europe from the Andes in the sixteenth century. In Ireland, the crop produced many calories on small plots and became especially important to poor tenant families. By the 1840s, poverty and an unequal landholding system left many people heavily dependent on potatoes while they had little money or land for alternatives.

In 1845, potato blight began ruining harvests, and it returned in later years. Yet blight alone does not explain the scale of the Great Irish Famine. Ireland still produced other foods, and food continued to leave Ireland through trade. Many hungry families could not afford that food or control the land that produced it. Relief policy also mattered. British government programs changed over time, but public works and other aid proved inadequate, while policies shaped by laissez-faire ideas limited responsibility. Evictions made the crisis worse for many tenants.

The catastrophe had several causes: a destructive plant disease, deep dependence on one crop, poverty, land and trade structures, and an insufficient state response. About one million people died, and many more emigrated. Remembering all of those causes does not make the blight unimportant. It explains why the same crop failure became a human disaster of such enormous size.`,
      questions: [
        question('q1', 'main-idea', 'What is the passage mainly arguing?', [
          'The potato was the main cause, while land and policy played almost no role.',
          'Ireland stopped producing every kind of food, so poverty, money, and land access no longer mattered.',
          'Blight became catastrophic through crop dependence, poverty, land structures, and inadequate policy.',
          'Tenant families had many alternatives, but they chose to depend only on potatoes.',
        ], 2, 'The final paragraph gathers the interacting causes: disease, dependence, poverty, land and trade structures, and state response.'),
        question('q2', 'detail', 'What does the passage say continued even while people were hungry?', [
          'Food continued to leave Ireland through trade.',
          'Potato harvests continued without damage.',
          'Every tenant continued to control a large farm.',
          'Relief programs continued to meet every need.',
        ], 0, 'The second paragraph states that Ireland produced other foods and that food continued to leave through trade.'),
        question('q3', 'inference', 'Why did the presence of other food not prevent widespread hunger?', [
          'The blight made every other food in Ireland poisonous and unsafe to sell.',
          'Many families lacked the money or control of land needed to obtain it.',
          'People had forgotten how to prepare any food that did not contain potatoes.',
          'The government did not know that farms were still producing other kinds of food.',
        ], 1, 'The passage connects hunger to poverty, prices, and lack of control over the land, not simply to the amount of food produced.'),
        question('q4', 'vocabulary', 'In the second paragraph, “relief” means', [
          'a map of higher and lower ground',
          'a feeling of surprise after good news',
          'a law requiring exports to increase',
          'aid given to people during a crisis',
        ], 3, 'Public works and other aid are examples of relief offered during the crisis.'),
      ],
      lesson: lesson(
        'Build a multi-causal explanation instead of looking for one villain or one mechanism. Paragraph one explains vulnerability, paragraph two separates the blight from access and policy, and paragraph three combines the causes. Use each claim at the level of certainty the passage gives it.',
        [
          signal('By the 1840s', 'Moves from the crop’s arrival to the conditions just before the crisis.'),
          signal('Yet blight alone does not explain', 'Rejects a one-cause account and opens the wider explanation.'),
          signal('Relief policy also mattered', 'Adds government choices to disease and economic conditions.'),
          signal('The catastrophe had several causes', 'Introduces the synthesis that states the main idea.'),
        ],
        [
          vocab('tenant', 'a person who farms or lives on land controlled by an owner'),
          vocab('blight', 'a plant disease that destroys or damages a crop'),
          vocab('relief', 'aid provided to people during a crisis'),
        ],
        {
          'main-idea': 'Prefer the option that preserves all the major causes. A choice naming only blight or only policy is incomplete.',
          detail: 'For a direct fact, return to the sentence about other foods and trade in paragraph two.',
          inference: 'Connect production with access: food can exist while people without money or land still cannot obtain it.',
          vocabulary: 'Use the nearby examples “public works and other aid” to define relief in this historical context.',
        },
      ),
    },
  }],

  ['og-his-great-wall', {
    sources: [
      'https://english.pku.edu.cn/events/10146.html',
      'https://iupress.org/9780253331878/peace-war-and-trade-along-the-great-wall/',
    ],
    replacement: {
      title: 'Walls Along Changing Frontiers',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'history',
      level: 2,
      wordCount: -1,
      text: `The Great Wall is not one wall built by one ruler. Long before China was united, northern states such as Qin, Zhao, and Yan built separate walls. Later dynasties repaired, joined, abandoned, or added sections. Much of the brick wall seen by visitors today comes from the Ming dynasty.

The walls stood along changing frontiers. Ming rulers used walls, gates, towers, and signals to watch movement and defend important routes. Neighboring pastoral peoples had their own leaders and goals. At different times, groups on both sides fought, negotiated, traded horses and grain, or crossed through guarded passes.

That history is more complex than one timeless China facing one timeless enemy. The walls helped some rulers manage a frontier, but they never sealed off all contact. Their different sections record changing systems of defense, control, diplomacy, and trade.`,
      questions: [
        question('q1', 'main-idea', 'What is the passage mostly about?', [
          'One continuous wall permanently separated two peoples who never traded or negotiated.',
          'Different states and dynasties used changing wall systems along active frontiers.',
          'Ming rulers built one road system mainly for merchants and modern visitors.',
          'Qin and Yan built the entire visible wall during one battle in a single year.',
        ], 1, 'The passage treats the walls as changing frontier systems with several purposes, not one timeless barrier.'),
        question('q2', 'detail', 'Which dynasty built much of the brick wall visitors see today?', [
          'The Ming dynasty',
          'The Roman dynasty',
          'The Ptolemaic dynasty',
          'The Ottoman dynasty',
        ], 0, 'The first paragraph directly says that much of the visible brick wall comes from the Ming dynasty.'),
        question('q3', 'inference', 'Why does the author mention both fighting and trading?', [
          'To show that every frontier exchange was peaceful and controlled by merchants',
          'To prove that walls and guarded passes were never used for defense or control',
          'To show that frontier relationships changed and were not only about invasion',
          'To explain why rulers permanently closed all guarded passes to travelers and trade',
        ], 2, 'The contrasting activities show a frontier where conflict, negotiation, and exchange all occurred.'),
        question('q4', 'vocabulary', 'In the passage, “pastoral” peoples were communities connected mainly with', [
          'raising and moving herds',
          'copying books in libraries',
          'building ships at sea',
          'growing crops inside city walls',
        ], 0, 'Here “pastoral” describes neighboring peoples whose lives and economies were strongly connected with herds.'),
      ],
      lesson: lesson(
        'Track change across time. The first paragraph replaces the idea of one wall with many building periods. The second names several frontier relationships, and the last explains why that variety matters. Avoid turning a changing borderland into a simple two-sided story.',
        [
          signal('not one wall built by one ruler', 'Corrects the simplest picture at the start.'),
          signal('The walls stood along changing frontiers', 'Shifts attention from a monument to the regions around it.'),
          signal('At different times', 'Signals that conflict, negotiation, and trade did not stay the same.'),
          signal('more complex than one timeless China', 'States why a simple civilization-versus-invader frame fails.'),
        ],
        [
          vocab('dynasties', 'lines of rulers from the same ruling family or house'),
          vocab('frontiers', 'border regions where peoples and political control meet'),
          vocab('pastoral', 'connected with raising and moving herds'),
        ],
        {
          'main-idea': 'Choose the summary that includes change over time and more than one frontier purpose.',
          detail: 'The dynasty tied to the visible brickwork is named in the final sentence of paragraph one.',
          inference: 'A list containing both conflict and exchange is evidence against a one-relationship account.',
          vocabulary: 'Use the nearby reference to trading horses to connect pastoral life with herding.',
        },
      ),
    },
  }],

  ['og-his-library-alexandria', {
    sources: [
      'https://www.lib.uchicago.edu/about/news/the-library-of-alexandria/',
      'https://chs.harvard.edu/annotation/the-libraries-of-alexandria-and-pergamon-as-classical-models-7/',
    ],
    replacement: {
      title: 'Scholarship at Ancient Alexandria',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'history',
      level: 3,
      wordCount: -1,
      text: `In the third century BCE, the Ptolemaic rulers of Egypt supported a scholarly institution in Alexandria often called the Mouseion. Its library sought texts from many places and languages. Scholars compared copies, prepared editions, translated works into Greek, and organized scrolls in catalogs. Their work made Alexandria an important center of study.

The institution was royal, not a modern public library. Resident scholars received support from the rulers, and surviving evidence does not show that anyone could simply enter and borrow a scroll. Even some famous stories about collecting books are difficult to verify. Its collection and scholarship were extraordinary, but its access rules remain uncertain.

The library weakened and disappeared through events that historians still debate; a single dramatic fire does not explain the whole history with certainty. Modern libraries may recognize an analogy in Alexandria’s efforts to collect, organize, and preserve knowledge. That is not the same as a direct line of descent or a claim that the ancient institution offered today’s ideal of public access.`,
      questions: [
        question('q1', 'main-idea', 'Which statement best summarizes the passage?', [
          'Alexandria was a royal center for collecting and organizing texts, not a modern public library.',
          'Alexandria created public borrowing rules and direct library traditions that continued unchanged into modern times.',
          'Alexandria’s collection disappeared in one known fire, leaving historians certain about how the institution ended.',
          'The Mouseion was mainly a harbor market where sailors bought and sold scrolls instead of a scholarly institution.',
        ], 0, 'The passage balances the institution’s major scholarly work with uncertainty about access and decline.'),
        question('q2', 'detail', 'What work did scholars at Alexandria do?', [
          'They trained harbor guards, inspected arriving ships, and collected taxes from sailors.',
          'They compared texts, prepared editions, translated works, and made catalogs.',
          'They lent scrolls to every resident and created the first system of public borrowing.',
          'They designed roads, repaired water channels, and managed construction throughout Egypt.',
        ], 1, 'Those four scholarly activities appear together in the first paragraph.'),
        question('q3', 'inference', 'Why does the author call modern libraries an “analogy” rather than direct descendants?', [
          'Modern libraries no longer collect, organize, preserve, or provide access to knowledge.',
          'The ancient collection consisted only of stone carvings rather than written scrolls.',
          'Similar goals do not prove direct institutional descent or identical public access.',
          'Historians have complete evidence that Alexandria admitted every visitor on equal terms.',
        ], 2, 'The final paragraph distinguishes a useful similarity from an unsupported direct lineage.'),
        question('q4', 'vocabulary', 'In the passage, an “institution” is', [
          'a single scroll copied and cataloged by hand',
          'a disputed rumor about a fire that ended a collection',
          'a ship arriving in the harbor with books on board',
          'an organized body created for a lasting purpose',
        ], 3, 'The Mouseion was an organized scholarly body supported by rulers, so “institution” names the organization rather than its books.'),
      ],
      lesson: lesson(
        'Separate documented functions from modern labels. Paragraph one establishes scholarly work; paragraph two limits the public-library comparison; paragraph three treats both decline and legacy cautiously. Words such as “uncertain,” “debate,” and “analogy” mark the evidence limits.',
        [
          signal('often called the Mouseion', 'Names the larger royal scholarly institution around the collection.'),
          signal('not a modern public library', 'Corrects a tempting but anachronistic label.'),
          signal('access rules remain uncertain', 'Marks what surviving evidence cannot securely establish.'),
          signal('recognize an analogy', 'Allows a comparison without claiming direct institutional descent.'),
        ],
        [
          vocab('institution', 'an organized body created for a continuing purpose'),
          vocab('catalogs', 'organized records describing items in a collection'),
          vocab('analogy', 'a comparison based on a meaningful similarity'),
        ],
        {
          'main-idea': 'Keep achievement and limitation together: major scholarship, royal structure, and uncertain public access.',
          detail: 'The first paragraph lists the scholars’ work in a four-part series.',
          inference: 'An analogy identifies similarity; it does not prove uninterrupted descent or identical access.',
          vocabulary: 'Use the royal support and resident scholars to see that institution means an organized body.',
        },
      ),
    },
  }],

  ['og-his-coffeehouse', {
    sources: [
      'https://academic.oup.com/hwj/article-abstract/51/1/127/706434',
      'https://newtonandthemint.history.ox.ac.uk/newtons-london/science-in-london',
    ],
    replacement: {
      title: 'Who Entered London’s Coffeehouses?',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'history',
      level: 3,
      wordCount: -1,
      text: `In late seventeenth- and early eighteenth-century London, coffeehouses offered news, business contacts, and conversation for the price of a drink. Merchants arranged deals, while writers and people interested in science or politics tested ideas in talk. Some rooms became known for a particular trade or subject. Their low price made them more accessible to many men than a court or university was.

Yet “open” did not mean equal. Women were generally excluded from taking part in English coffeehouse discussion, although some worked in or operated the businesses. Rules about dress and behavior could also keep poorer people out. Customers did not form one perfectly mixed public: occupation, neighborhood, money, and social custom shaped who entered which room and whose voice carried authority.

Coffeehouses still mattered as places where print, rumor, observation, and argument met. Some later businesses and clubs grew from their networks. Their history shows both the power and the limit of a public meeting place: ideas can travel farther when strangers exchange them, but a room cannot represent everyone if its doors and customs exclude many people.`,
      questions: [
        question('q1', 'main-idea', 'What is the passage mainly about?', [
          'Coffeehouses spread ideas and business, but access and influence remained unequal.',
          'Every London resident entered coffeehouses and influenced public debates on equal terms.',
          'Coffeehouses mattered only because a new drink kept every customer alert and sober.',
          'London’s courts and universities closed when cheap coffeehouses became popular.',
        ], 0, 'The passage presents both the exchange that coffeehouses enabled and the exclusions that limited their public role.'),
        question('q2', 'detail', 'What could make a coffeehouse known for a particular focus?', [
          'Each room served a different kind of coffee plant.',
          'Some rooms became linked with a trade or subject.',
          'The government assigned every citizen one room.',
          'All rooms admitted only university teachers.',
        ], 1, 'The first paragraph says some rooms became known for a particular trade or subject.'),
        question('q3', 'inference', 'Why does the author place “open” in quotation marks?', [
          'To suggest that coffeehouse conversations usually took place outdoors in public streets',
          'To show that coffeehouse buildings stayed open every hour of the day and night',
          'To question the idea that low cost created equal access for everyone',
          'To claim that customers exchanged business news but never discussed ideas inside',
        ], 2, 'The next sentences explain gender and class limits, so the quotation marks challenge an overly broad meaning of “open.”'),
        question('q4', 'vocabulary', 'In the final paragraph, “networks” means', [
          'woven bags that merchants used to carry roasted coffee beans',
          'groups of connected people and relationships',
          'lists of dress and behavior rules posted on a coffeehouse door',
          'roads connecting London coffeehouses directly with overseas farms',
        ], 1, 'Businesses and clubs could grow from connected customers and their relationships, which form networks.'),
      ],
      lesson: lesson(
        'Read for a qualified claim. Paragraph one explains why coffeehouses mattered; paragraph two tests the word “open” against gender and class; paragraph three keeps the exchange thesis but gives it a limit. A strong summary must preserve both sides.',
        [
          signal('more accessible to many men', 'Scopes the comparison instead of claiming access for almost anyone.'),
          signal('Yet “open” did not mean equal', 'Introduces the exclusions that qualify the opening account.'),
          signal('Coffeehouses still mattered', 'Returns to their influence without erasing the limits.'),
          signal('both the power and the limit', 'States the two-part historical conclusion.'),
        ],
        [
          vocab('accessible', 'possible for more people to enter or use'),
          vocab('excluded', 'kept from entering or participating'),
          vocab('networks', 'connected people and relationships through which activity spreads'),
        ],
        {
          'main-idea': 'A complete answer needs the exchange of ideas and the unequal boundaries around participation.',
          detail: 'Look in paragraph one for the sentence about rooms known for a trade or subject.',
          inference: 'Quotation marks can challenge a label; here paragraph two explains why “open” needs limits.',
          vocabulary: 'Use the businesses and clubs growing from customer relationships to define networks.',
        },
      ),
    },
  }],

  ['og-his-roman-roads', {
    sources: [
      'https://www.english-heritage.org.uk/learn/story-of-england/romans/roman-roads/',
      'https://www.english-heritage.org.uk/learn/story-of-england/romans/networks/',
    ],
    replacement: {
      title: 'Roman Roads: Movement and Power',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'history',
      level: 3,
      wordCount: -1,
      text: `After conquering territory, Roman armies built and improved roads to connect forts, towns, ports, and administrative centers. Surveyors aimed for direct routes where the land allowed. Workers raised some roadbeds, added layers of stone, and built drainage so water would not quickly ruin the surface. The network helped troops and official messages move across a province.

Those roads were tools of imperial power. They helped authorities occupy land, collect taxes and supplies, and respond to resistance. Roads could carry resources toward Roman centers as well as soldiers toward a frontier. For communities brought under Roman rule, faster movement could therefore mean control and extraction, not a neutral benefit.

The same routes also supported travel and exchange. Traders took goods to markets, officials and other travelers used stopping places, and some towns grew near busy roads. Benefits varied by person and status; a merchant, a soldier, and a conquered farmer did not experience the network in the same way. Roman roads lasted because they joined engineering with administration, commerce, and conquest.`,
      questions: [
        question('q1', 'detail', 'Why did workers build up roadbeds and add drainage?', [
          'To hide the route from armies moving through the province after dark',
          'To help water leave instead of quickly damaging the surface',
          'To make every major route follow a river from its source to the sea',
          'To prevent traders and other travelers from reaching towns by road',
        ], 1, 'The first paragraph says layers and drainage helped keep water from quickly ruining the road.'),
        question('q2', 'inference', 'Why might a conquered farmer view a road differently from a merchant?', [
          'The farmer could experience taxation and control while the merchant valued market access.',
          'The farmer could not see a stone road, while the merchant could identify every building layer.',
          'The merchant never encountered taxes, control, or soldiers while using an imperial road.',
          'Roman law allowed merchants to travel freely but prohibited every farmer from using a road.',
        ], 0, 'The passage contrasts roads as routes for exchange with roads as tools of occupation, taxation, and extraction.'),
        question('q3', 'main-idea', 'Which statement best gives the passage’s main idea?', [
          'Roman roads benefited every person in a conquered province in exactly the same way.',
          'Roman roads were designed only to make trade cheaper and had no military purpose.',
          'Roman roads combined engineering and exchange with conquest and imperial control.',
          'Roman roads had little connection to military activity, administration, or political power.',
        ], 2, 'The final sentence joins the network’s engineering and commercial uses to administration and conquest.'),
        question('q4', 'vocabulary', 'In the passage, “extraction” means', [
          'removing resources or wealth from a place',
          'measuring how straight a route remains across uneven land',
          'building a place where officials and travelers can stop',
          'trading one kind of road stone for another local material',
        ], 0, 'The nearby examples of taxes, supplies, and resources moving toward Roman centers show what extraction means.'),
      ],
      lesson: lesson(
        'Track users and purposes rather than labeling infrastructure simply good or bad. Paragraph one gives military and engineering purposes, paragraph two adds control and extraction, and paragraph three shows travel and trade. The contrast among three users prevents a universal-benefit claim.',
        [
          signal('After conquering territory', 'Places road building inside the expansion of Roman rule.'),
          signal('tools of imperial power', 'Names the control function behind movement.'),
          signal('The same routes also supported', 'Adds exchange without canceling the earlier costs.'),
          signal('Benefits varied by person and status', 'Rejects the claim that the roads helped everyone equally.'),
        ],
        [
          vocab('administrative', 'connected with organizing and governing a territory'),
          vocab('extraction', 'the removal of resources or wealth from a place'),
          vocab('status', 'a person’s position within a social or political system'),
        ],
        {
          'main-idea': 'Choose the option that holds military control, engineering, and exchange together.',
          detail: 'For construction purpose, return to the drainage sentence in paragraph one.',
          inference: 'Compare what the same road carries for authorities, merchants, and conquered communities.',
          vocabulary: 'Taxes, supplies, and resources moving toward imperial centers reveal the meaning of extraction.',
        },
      ),
    },
  }],

  ['og-his-printing-vaccine', {
    sources: [
      'https://www.who.int/news-room/spotlight/history-of-vaccination/history-of-smallpox-vaccination',
    ],
    replacement: {
      title: 'Before and After Jenner’s Vaccine',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'history',
      level: 5,
      wordCount: -1,
      text: `Long before vaccination, communities in parts of Asia and Africa practiced forms of variolation: introducing material from a person with smallpox in hopes of causing a milder infection and later protection. The method carried serious risks, but knowledge of it traveled to other regions. Edward Jenner’s work therefore began within a longer, international history of preventing smallpox.

In England, Jenner also learned from rural observations that people who had caught cowpox seemed protected from smallpox. In 1796, he used material linked to cowpox from Sarah Nelmes in an experiment on James Phipps, his gardener’s eight-year-old son. Jenner later deliberately exposed Phipps to smallpox, and the boy did not develop the disease.

That experiment helped demonstrate a path toward vaccination, but it also presents an ethical wrong. An eight-year-old could not provide modern informed consent, and exposing a child to such danger would violate current research protections. Naming that problem is part of telling the history accurately, not a denial that vaccination became valuable.

Jenner did not end smallpox alone. Researchers, vaccine producers, governments, the World Health Organization, and local health workers built later campaigns. Vaccination was combined with case finding, surveillance, and rapid containment across many countries. In 1980, the World Health Assembly declared smallpox eradicated. The achievement joined earlier knowledge, scientific testing, public-health organization, and sustained work by many people.`,
      questions: [
        question('q1', 'main-idea', 'Which statement best summarizes the passage?', [
          'Jenner alone invented smallpox prevention, ran an ethical child experiment, and immediately achieved global eradication.',
          'Earlier knowledge and Jenner’s unethical experiment advanced smallpox vaccination; eradication required collective work.',
          'Variolation and vaccination were identical, equally safe practices developed entirely by Jenner.',
          'Smallpox disappeared after one English experiment, before organized international campaigns began.',
        ], 1, 'The passage joins earlier variolation, Jenner’s contribution and ethical failure, and the later international eradication campaign.'),
        question('q2', 'detail', 'What practice existed before Jenner’s vaccination experiment?', [
          'Modern informed-consent review',
          'Worldwide laboratory surveillance',
          'Variolation in parts of Asia and Africa',
          'The World Health Assembly’s eradication declaration',
        ], 2, 'The opening paragraph describes forms of variolation practiced before vaccination.'),
        question('q3', 'inference', 'Why does the passage discuss informed consent?', [
          'To show that useful results erase concerns about how research is conducted',
          'To explain why Phipps designed Jenner’s experiment',
          'To argue that all historical medicine should be ignored',
          'To evaluate the experiment’s method as well as its later importance',
        ], 3, 'The passage says ethical criticism belongs in an accurate account even when the later medical contribution mattered.'),
        question('q4', 'vocabulary', 'In the final paragraph, “eradicated” means', [
          'made more difficult to observe',
          'eliminated worldwide',
          'renamed by an international group',
          'treated in one English village',
        ], 1, 'The declaration followed coordinated work across many countries, so “eradicated” means eliminated worldwide.'),
      ],
      lesson: lesson(
        'Read this as a layered history, not a lone-inventor story. Paragraph one establishes earlier practice; paragraphs two and three separate a result from the ethics of the experiment; paragraph four distributes credit for eradication across a public-health network.',
        [
          signal('Long before vaccination', 'Places earlier prevention knowledge before Jenner’s experiment.'),
          signal('also presents an ethical wrong', 'Turns from the result to the treatment of the child participant.'),
          signal('did not end smallpox alone', 'Rejects lone-person credit for global eradication.'),
          signal('Vaccination was combined with', 'Introduces the other public-health methods needed in the campaign.'),
        ],
        [
          vocab('variolation', 'an older, risky method intended to produce protection from smallpox'),
          vocab('consent', 'an informed and voluntary agreement to take part'),
          vocab('eradicated', 'eliminated worldwide through sustained public-health work'),
        ],
        {
          'main-idea': 'A complete summary includes earlier knowledge, Jenner and Phipps, the ethical problem, and collective eradication.',
          detail: 'The first paragraph names the preventive practice that came before vaccination.',
          inference: 'Historical importance and ethical acceptability are separate questions; the passage evaluates both.',
          vocabulary: 'Use the worldwide campaign and 1980 declaration to distinguish eradication from local control.',
        },
      ),
    },
  }],

  ['og-bio2-humboldt-web-of-nature', {
    sources: [
      'https://asclepio.revistas.csic.es/index.php/asclepio/article/view/1187',
      'https://www.humboldt-foundation.de/fileadmin/Entdecken/Magazin_Humboldt_Kosmos/116_2024/Kosmos-116_everything-just-looted_EN.pdf',
      'https://www.cambridge.org/core/product/identifier/S0007087418000778/type/journal_article',
    ],
    replacement: {
      title: 'Humboldt’s Network of Knowledge',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'biography',
      level: 4,
      wordCount: -1,
      text: `From 1799 to 1804, Alexander von Humboldt traveled through Spanish America with Aimé Bonpland, a French botanist and physician. They measured temperature and altitude, collected specimens, and compared plants across climates. A rare passport from the Spanish Crown gave them unusual access to colonial territories. Their journey was never the work of one observer moving through empty landscapes.

Indigenous guides and knowledge holders, boat crews, interpreters, local residents, and scholars helped the travelers choose routes and understand plants and places. In the Orinoco region, Indigenous geographic knowledge was essential to navigation. Humboldt and Bonpland learned through these encounters, although later European publications often placed Humboldt’s name in the foreground and made other contributors harder to see.

Humboldt’s distinctive achievement was to synthesize many observations. On the Andes, patterns of vegetation changing with altitude helped him picture nature as an interconnected system. Near Lake Valencia, he connected plantation agriculture and forest clearing with changes in water and climate. These comparisons challenged the idea that natural facts should be studied only as isolated items.

His work remains influential, but a fuller biography changes the lone-genius story. It credits Bonpland and local and Indigenous expertise, and it recognizes that colonial permission shaped where the expedition could travel and whose knowledge entered print.`,
      questions: [
        question('q1', 'main-idea', 'What is the passage mainly arguing?', [
          'Humboldt worked alone and discovered all places and natural knowledge entirely unknown to the people living there.',
          'Humboldt’s synthesis mattered, but it depended on Bonpland, local and Indigenous knowledge, and colonial access.',
          'The expedition collected plants but avoided comparing environments or connecting observations.',
          'Colonial officials denied all travel permission, so the expedition remained in one port city.',
        ], 1, 'The passage retains Humboldt’s systems insight while placing it inside a network of collaborators, knowledge, and political access.'),
        question('q2', 'detail', 'Who traveled with Humboldt through Spanish America?', [
          'Aimé Bonpland, a botanist and physician',
          'Edward Jenner, an English physician who studied smallpox vaccination',
          'Sequoyah, a Cherokee silversmith who developed a writing system',
          'James Phipps, the child who participated in Jenner’s experiment',
        ], 0, 'The opening sentence identifies Aimé Bonpland and his fields of work.'),
        question('q3', 'inference', 'Why does the author mention the Spanish Crown’s passport?', [
          'To show that scientific travel was shaped by colonial political power',
          'To prove that the travelers personally owned every place and specimen they encountered',
          'To show that royal permission made local guides and knowledge holders unnecessary',
          'To explain the instrument the travelers used to measure altitude on the Andes',
        ], 0, 'The passport gave unusual entry into colonized territories, so political permission affected where the expedition could work.'),
        question('q4', 'vocabulary', 'In the passage, “synthesize” means', [
          'hide the sources of each piece of information in a later publication',
          'collect many specimens while avoiding comparisons among them',
          'combine many observations into a connected understanding',
          'translate each observation word for word into another language',
        ], 2, 'The following sentences show Humboldt combining observations of altitude, vegetation, land use, water, and climate.'),
      ],
      lesson: lesson(
        'Read a biography for both contribution and conditions. Paragraph one names the expedition pair and colonial access; paragraph two restores contributors; paragraph three identifies Humboldt’s synthesis; paragraph four recombines them into a networked account.',
        [
          signal('never the work of one observer', 'Rejects the empty-landscape and lone-traveler frame.'),
          signal('essential to navigation', 'States a concrete dependence on Indigenous geographic knowledge.'),
          signal('distinctive achievement was to synthesize', 'Identifies Humboldt’s contribution without assigning all discovery to him.'),
          signal('a fuller biography changes', 'Introduces the revised account of credit and access.'),
        ],
        [
          vocab('colonial', 'connected with rule imposed by an outside imperial power'),
          vocab('synthesize', 'combine many observations into a connected understanding'),
          vocab('expertise', 'deep knowledge or skill developed through experience'),
        ],
        {
          'main-idea': 'Preserve both parts: Humboldt’s synthesis and the people and political conditions that enabled it.',
          detail: 'The opening sentence names Bonpland and describes his fields.',
          inference: 'A royal passport is evidence that access to places and knowledge was structured by colonial authority.',
          vocabulary: 'The Andes and Lake Valencia examples show separate observations being combined into systems.',
        },
      ),
    },
  }],

  ['og-bio2-sequoyah-writes-cherokee', {
    sources: [
      'https://www.cherokee.org/all-services/language-department/',
      'https://www.cherokee.org/about-the-nation/history/',
    ],
    replacement: {
      title: 'Sequoyah Creates a Cherokee Syllabary',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'biography',
      level: 2,
      wordCount: -1,
      text: `In the early 1800s, Cherokee people already spoke a rich language, but it did not yet have a widely used writing system. Sequoyah, a Cherokee silversmith, saw how English writing carried messages. He began searching for a way to represent Cherokee speech on a page.

At first, Sequoyah tried to make one symbol for each word. There were far too many words for that plan. He changed his method and made symbols for the syllables, or sound units, used in Cherokee. He completed a set of eighty-five characters. A syllabary is not an alphabet: its characters represent syllables rather than single letters.

Sequoyah tested the system with his daughter. They could exchange written messages even when they had not heard each other speak. The test showed that the marks carried Cherokee words.

The Cherokee Nation adopted the syllabary in 1825, and many Cherokee people learned it rapidly. In 1828, the Cherokee Phoenix newspaper began printing in both Cherokee and English. Sequoyah did not create the Cherokee language. He created a writing system that Cherokee speakers used to record and share their existing language.`,
      questions: [
        question('q1', 'main-idea', 'Which statement best gives the passage’s main idea?', [
          'Sequoyah invented the Cherokee language and then taught its existing speakers how to write and speak it.',
          'Sequoyah replaced Cherokee speech with English letters borrowed for a new alphabet.',
          'Sequoyah created a syllabary that enabled Cherokee speakers to write their existing language.',
          'Sequoyah built a printing press that could publish only English-language newspapers.',
        ], 2, 'The passage is specifically about Sequoyah creating a syllabary for the existing Cherokee language.'),
        question('q2', 'detail', 'Why did Sequoyah abandon one symbol for every word?', [
          'The Cherokee language had too many words for a separate symbol for every word.',
          'His daughter could not hear any spoken Cherokee during their later test.',
          'The Cherokee Nation required him to use letters from an English alphabet.',
          'Newspapers of the period could print numbers but could not print written words.',
        ], 0, 'The second paragraph says there were far too many words for a one-symbol-per-word system.'),
        question('q3', 'inference', 'What did the test with Sequoyah’s daughter show?', [
          'The characters worked only when both people spoke each written message aloud.',
          'The writing could carry Cherokee words between people on its own.',
          'The writing system still needed thousands of symbols before it could carry a message.',
          'The symbols represented English words instead of the sounds used in spoken Cherokee.',
        ], 1, 'Because they exchanged messages without hearing each other, the marks themselves had to carry the Cherokee words.'),
        question('q4', 'vocabulary', 'A “syllabary” is a writing system whose characters represent', [
          'whole books or stories rather than units of sound',
          'single numbers used to count printed characters',
          'only the names of people, places, and newspapers',
          'syllables in spoken words',
        ], 3, 'The second paragraph defines a syllabary by contrasting syllables with the single letters of an alphabet.'),
      ],
      lesson: lesson(
        'Keep language and writing system separate. Paragraph one names the existing spoken language, paragraph two defines the syllabary, paragraph three tests it, and paragraph four shows adoption. The final contrast prevents the misleading claim that Sequoyah created Cherokee itself.',
        [
          signal('already spoke a rich language', 'Establishes that Cherokee existed before this writing system.'),
          signal('He changed his method', 'Marks the shift from a failed word-symbol plan to syllables.'),
          signal('A syllabary is not an alphabet', 'Defines the precise type of writing system by contrast.'),
          signal('did not create the Cherokee language', 'Corrects the title-level misconception directly.'),
        ],
        [
          vocab('silversmith', 'a craftsperson who makes or repairs objects made of silver'),
          vocab('syllables', 'sound units that form spoken words'),
          vocab('syllabary', 'a writing system with characters representing syllables'),
        ],
        {
          'main-idea': 'Use the precise title: Sequoyah created a Cherokee syllabary, not the Cherokee language.',
          detail: 'The failed plan and its problem are both stated at the start of paragraph two.',
          inference: 'Messages exchanged without spoken clues show that the marks themselves carried language.',
          vocabulary: 'Use the explicit contrast: a syllabary represents syllables, while an alphabet represents letters.',
        },
      ),
    },
  }],

  ['og-phi-the-trolley-problem', {
    sources: [
      'https://plato.stanford.edu/entries/thought-experiment/',
    ],
    replacement: {
      title: 'The Art-Kit Dilemma',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'philosophy',
      level: 4,
      wordCount: -1,
      text: `A community library receives six identical art kits. Six beginners have each asked for one kit so they can try printmaking. A mural team has asked for all six because its detailed project needs every set of tools. Both plans start at the same time, so the library must choose. Should it give one opportunity to each of six people, or support one shared project that cannot happen with fewer kits?

Now add one fact: months earlier, before the beginners registered, the coordinator promised the mural team that it could use all six kits. The supplies and proposed projects have not changed, but a promise has entered the case. Some readers may change their answer; others may think equal access or the number of separate learners still matters more.

The art-kit dilemma is a thought experiment, not a puzzle with an official solution. Comparing its two versions helps reveal which reasons guide a judgment. One person may emphasize keeping promises, another equal opportunity, another the number of separate learners, and another the depth of a project. Its value is diagnostic: it makes competing principles visible so that people can examine, explain, and revise their reasons.`,
      questions: [
        question('q1', 'main-idea', 'What does the art-kit dilemma mainly help readers examine?', [
          'The art-kit dilemma reveals how competing fairness principles shape a judgment.',
          'The art-kit dilemma identifies which printmaking tools a library should buy first.',
          'The art-kit dilemma proves that libraries should never lend equipment to groups.',
          'The art-kit dilemma explains how one team can finish a detailed mural in an afternoon.',
        ], 0, 'The final paragraph says the thought experiment makes competing principles and reasons visible.'),
        question('q2', 'detail', 'What new fact appears in the second version?', [
          'The six beginners decide to combine their projects and join the mural team.',
          'The coordinator had already promised all six kits to the mural team.',
          'The library receives six more art kits after the beginners register for printmaking.',
          'The mural team changes its plan so that the project can be completed with one kit.',
        ], 1, 'The second paragraph adds the coordinator’s earlier promise while leaving the supplies and projects unchanged.'),
        question('q3', 'inference', 'Why does the thought experiment change only one important fact?', [
          'To isolate how a promise affects reasoning about the same allocation',
          'To prove that promises always defeat every other value',
          'To hide how many kits and separate learners are included in the first version',
          'To make the two proposed projects identical in their goals, tools, and size',
        ], 0, 'Holding most of the case steady makes it easier to see whether the added promise changes the judgment.'),
        question('q4', 'vocabulary', 'In “Its value is diagnostic,” “diagnostic” most nearly means', [
          'able to reveal how something works',
          'guaranteed to give one official answer',
          'connected only with medical treatment',
          'too complicated to discuss',
        ], 0, 'The dilemma reveals the principles behind a judgment, so its role is diagnostic rather than final.'),
      ],
      lesson: lesson(
        'Compare controlled versions of a thought experiment. First list the values already in tension; then identify the single added fact. The final paragraph explains the purpose: reveal and test reasons, not force one official choice.',
        [
          signal('Now add one fact', 'Marks the controlled change between the two versions.'),
          signal('have not changed, but a promise has', 'Isolates the new moral consideration.'),
          signal('not a puzzle with an official solution', 'Clarifies that the task is examining reasons, not finding a key.'),
          signal('Its value is diagnostic', 'States that the case reveals the principles behind judgments.'),
        ],
        [
          vocab('dilemma', 'a choice in which important reasons support different options'),
          vocab('principles', 'general values or rules used to guide judgments'),
          vocab('diagnostic', 'able to reveal the parts or causes behind a result'),
        ],
        {
          'main-idea': 'Summarize what the comparison reveals, not which group you personally would choose.',
          detail: 'Version two changes one fact: an earlier promise to the mural team.',
          inference: 'When most facts stay fixed, a changed response points to the importance of the one new fact.',
          vocabulary: 'The colon explains diagnostic: the dilemma makes competing principles visible.',
        },
      ),
    },
  }],

  ['og-l4-wrong-turn-in-sarajevo', {
    sources: [
      'https://www.iwm.org.uk/history/how-the-world-went-to-war-in-1914',
      'https://guides.loc.gov/chronicling-america-assassination-franz-ferdinand',
    ],
    replacement: {
      title: 'Sarajevo and the July Crisis',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: ORIGINAL_ATTRIBUTION,
      genre: 'history',
      level: 4,
      wordCount: -1,
      releasedAt: '2026-08-05',
      text: `On June 28, 1914, Archduke Franz Ferdinand, heir to the Austro-Hungarian throne, made an official visit to Sarajevo with his wife, Sophie. Bosnia was under Austro-Hungarian rule, and nationalist movements opposed that rule. An earlier attack on the visitors failed. Afterward, Franz Ferdinand chose to visit people affected by the attack at a hospital, but confusion about the changed route caused his car to stop near Gavrilo Princip. Princip, a member of the nationalist conspiracy, assassinated Franz Ferdinand and Sophie.

The route confusion shaped the immediate event, but it does not by itself explain a world war. Europe was already marked by imperial rivalry, military planning, nationalism, and alliances. The assassination became a trigger inside that tense system.

During the July Crisis, leaders made further choices. Austria-Hungary, backed by Germany, sent Serbia an ultimatum. Serbia accepted many demands but not all of them. Mobilizations and declarations followed as governments responded to both their plans and one another. By early August, several major powers were at war. The Sarajevo assassination mattered greatly, yet war grew from the political conditions and decisions that followed it, not from one driver’s mistake alone.`,
      questions: [
        question('q1', 'main-idea', 'Which statement best captures the passage’s main idea?', [
          'Route confusion shaped the assassination; wider tensions and later political choices turned crisis into war.',
          'A driver’s mistake made the assassination and every government’s later political and military decision unavoidable.',
          'Europe’s alliances had no role in the crisis because the route confusion alone caused the war.',
          'The official visit to Sarajevo occurred after a world war had already begun across Europe.',
        ], 0, 'The passage separates the chance event in Sarajevo from the political conditions and decisions of the July Crisis.'),
        question('q2', 'inference', 'Why does the passage include the route confusion?', [
          'To show that chance shaped the immediate event without fully explaining the later war',
          'To prove that Princip had no political goal or connection with a nationalist conspiracy',
          'To show that all European leaders wanted a world war before the assassination occurred',
          'To claim that the hospital was outside Sarajevo and therefore impossible to visit',
        ], 0, 'The second paragraph explicitly limits what the route can explain: it affected the encounter, not the whole chain to war.'),
        question('q3', 'vocabulary', 'In the passage, an “ultimatum” is', [
          'a private travel plan for an official visit through a city',
          'a set of final demands backed by a threatened consequence',
          'a public celebration held after a visiting official leaves a city',
          'an agreement in which governments end every military plan immediately',
        ], 1, 'Austria-Hungary sent demands that Serbia had to answer during an escalating crisis, which fits an ultimatum.'),
        question('q4', 'detail', 'What change followed the earlier failed attack?', [
          'Franz Ferdinand decided to leave Sarajevo immediately and cancel the rest of the visit.',
          'Princip became the official driver and selected a new route through the city.',
          'European governments ended their military plans and alliances before the July Crisis.',
          'Franz Ferdinand chose to visit people affected at a hospital.',
        ], 3, 'The opening paragraph says the hospital visit changed the planned route after the earlier attack.'),
      ],
      lesson: lesson(
        'Separate trigger, background conditions, and later decisions. Paragraph one gives the immediate Sarajevo event without graphic detail; paragraph two limits the wrong-turn explanation; paragraph three traces the July Crisis. A cause can matter without being sufficient by itself.',
        [
          signal('but confusion about the changed route', 'Identifies the chance element in the immediate encounter.'),
          signal('does not by itself explain', 'Limits how much one event can account for.'),
          signal('became a trigger inside', 'Connects the assassination with already existing tensions.'),
          signal('leaders made further choices', 'Moves responsibility from chance to decisions during the crisis.'),
        ],
        [
          vocab('nationalist', 'connected with a movement seeking power or self-rule for a nation'),
          vocab('trigger', 'an event that starts a process under conditions already in place'),
          vocab('ultimatum', 'final demands backed by a threatened consequence'),
        ],
        {
          'main-idea': 'Include both scales: the Sarajevo encounter and the political chain that expanded the crisis.',
          detail: 'The changed hospital visit appears in paragraph one before the route confusion.',
          inference: 'The author includes chance, then explicitly limits it; use that boundary when explaining causation.',
          vocabulary: 'Read ultimatum with the demands, response, and escalation that surround it.',
        },
      ),
    },
  }],

  ['pd-aesop-ant-grasshopper', {
    sources: [
      'https://www.loc.gov/item/07028340/',
    ],
    replacement: {
      title: 'The Ant and the Grasshopper',
      sourceType: 'original',
      source: ORIGINAL_SOURCE,
      attribution: 'Original modern adaptation of Aesop’s public-domain fable © Studio AM, written for Fluency.',
      genre: 'fable',
      level: 1,
      wordCount: -1,
      text: `All summer, Ant carried seeds to her pantry. Grasshopper sang beside the path. “Come rest,” he called. Ant smiled and said, “I will rest soon. First I am saving food for cold days.” Grasshopper thought there would always be plenty.

When cold rain arrived, Grasshopper’s pantry was empty. He knocked on Ant’s door and asked for help. Ant welcomed him in and shared a warm bowl of soup. Then she said, “Tomorrow, please help me count and sort the seeds.”

Grasshopper kept his promise. He worked beside Ant, and he sang while they sorted. By spring, he had learned how to plan ahead. Ant had shown him another lesson too: good planning and kindness can work together.`,
      questions: [
        question('q1', 'main-idea', 'What lesson does this fable teach?', [
          'Planning ahead and helping someone learn can work together.',
          'Singing and resting are mistakes that should never happen while anyone works.',
          'Only ants can learn how to save enough food before cold weather arrives.',
          'A promise is useful only during warm weather, when food is already plentiful.',
        ], 0, 'The ending joins Grasshopper’s new planning with Ant’s kindness and help.'),
        question('q2', 'detail', 'What did Ant ask Grasshopper to do the next day?', [
          'Sing beside the path until spring',
          'Count and sort the seeds',
          'Build a new door for the pantry',
          'Carry the empty soup bowl outside',
        ], 1, 'Ant directly asks Grasshopper to help count and sort the seeds.'),
        question('q3', 'vocabulary', 'A “pantry” is a place where someone keeps', [
          'songs',
          'food',
          'rain',
          'paths',
        ], 1, 'Ant stores seeds in her pantry, while Grasshopper’s empty pantry leaves him without food.'),
        question('q4', 'inference', 'Why did Grasshopper work with Ant after she shared the soup?', [
          'He wanted to keep his promise and learn to prepare.',
          'He planned to hide every seed so that Ant could not find the food later.',
          'He had forgotten how to sing after staying indoors during the cold rain.',
          'He wanted the cold rain to continue until the path and pantry were empty.',
        ], 0, 'The story says he kept his promise, worked beside Ant, and learned to plan ahead.'),
      ],
      lesson: lesson(
        'Follow the two choices across the seasons: Ant prepares, Grasshopper delays, and cold rain reveals the result. Then notice the modern ending. Ant helps without abandoning responsibility, and Grasshopper responds by learning and keeping a promise.',
        [
          signal('First I am saving food', 'States Ant’s plan before the weather changes.'),
          signal('When cold rain arrived', 'Marks the seasonal turn that tests both choices.'),
          signal('Grasshopper kept his promise', 'Shows that help leads to effort and learning.'),
          signal('planning and kindness can work together', 'States the balanced lesson at the end.'),
        ],
        [
          vocab('pantry', 'a place where food is stored'),
          vocab('promise', 'a commitment to do what one has said'),
          vocab('plenty', 'more than enough of something'),
        ],
        {
          'main-idea': 'Use the final sentence: the lesson combines preparing for the future with kindness.',
          detail: 'Ant’s request appears inside quotation marks in paragraph two.',
          inference: 'Grasshopper’s later actions show that he accepts help as a chance to learn, not simply a free meal.',
          vocabulary: 'Seeds go into Ant’s pantry and food is missing from Grasshopper’s, so pantry is a storage place.',
        },
      ),
    },
  }],
]);

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--input' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
      options[argument.slice(2)] = isAbsolute(value) ? value : resolve(process.cwd(), value);
      index += 1;
    } else if (argument === '--help') {
      console.log('Usage: node scripts/repair-legacy-history.mjs [--dry-run] [--input PATH] [--output PATH]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.output === null) options.output = options.input;
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function collapseParagraphLayout(text) {
  return text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).join(' ');
}

function sourceDigest(passage) {
  const canonical = structuredClone(passage);
  canonical.text = collapseParagraphLayout(canonical.text);
  return sha256(JSON.stringify(canonical));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function completeDigest(passage) {
  return sha256(JSON.stringify(canonicalize(passage)));
}

function replacementPassage(id, replacement) {
  const passage = {
    id,
    title: replacement.title,
    sourceType: replacement.sourceType,
    source: replacement.source,
    attribution: replacement.attribution,
    genre: replacement.genre,
    level: replacement.level,
    wordCount: replacement.text.trim().split(/\s+/).length,
  };
  if (Object.hasOwn(replacement, 'releasedAt')) passage.releasedAt = replacement.releasedAt;
  passage.text = replacement.text;
  passage.questions = replacement.questions;
  passage.lesson = replacement.lesson;
  return structuredClone(passage);
}

function applyReplacement(passage, expected) {
  for (const field of Object.keys(passage)) delete passage[field];
  Object.assign(passage, structuredClone(expected));
}

// Correct choices were reviewed before layout. The explicit, nonsequential
// positions avoid both a repeated per-passage pattern and corpus-level skew.
// Across 44 questions each answer position occurs exactly eleven times.
const ANSWER_POSITIONS = new Map([
  ['og-his2-the-potato-in-europe', [2, 0, 2, 3]],
  ['og-his-great-wall', [0, 3, 1, 1]],
  ['og-his-library-alexandria', [3, 1, 0, 3]],
  ['og-his-coffeehouse', [1, 3, 2, 0]],
  ['og-his-roman-roads', [2, 0, 3, 2]],
  ['og-his-printing-vaccine', [0, 2, 1, 1]],
  ['og-bio2-humboldt-web-of-nature', [3, 1, 0, 2]],
  ['og-bio2-sequoyah-writes-cherokee', [1, 2, 3, 1]],
  ['og-phi-the-trolley-problem', [2, 0, 3, 0]],
  ['og-l4-wrong-turn-in-sarajevo', [3, 1, 0, 2]],
  ['pd-aesop-ant-grasshopper', [0, 2, 1, 3]],
]);

if (ANSWER_POSITIONS.size !== REPAIRS.size
    || [...REPAIRS.keys()].some((id) => !ANSWER_POSITIONS.has(id))) {
  throw new Error('Answer-position plans and repair targets must match exactly.');
}
const plannedPositions = [0, 0, 0, 0];
for (const [id, repair] of REPAIRS) {
  repair.replacement.wordCount = repair.replacement.text.trim().split(/\s+/).length;
  const positions = ANSWER_POSITIONS.get(id);
  if (!Array.isArray(positions) || positions.length !== repair.replacement.questions.length) {
    throw new Error(`${id}: answer-position plan must cover every question.`);
  }
  if ([0, 1, 2, 3].some((offset) =>
    positions.every((position, index) => position === (index + offset) % 4))) {
    throw new Error(`${id}: answer-position plan must not expose a cyclic q1..q4 sequence.`);
  }
  repair.replacement.questions.forEach((item, questionIndex) => {
    const target = positions[questionIndex];
    if (!Number.isInteger(target) || target < 0 || target > 3) {
      throw new Error(`${id}/${item.id}: invalid planned answer position ${target}.`);
    }
    plannedPositions[target] += 1;
    if (item.answer === target) return;
    const correct = item.choices[item.answer];
    const distractors = item.choices.filter((_choice, index) => index !== item.answer);
    distractors.splice(target, 0, correct);
    item.choices = distractors;
    item.answer = target;
  });
}
if (plannedPositions.some((count) => count !== 11)) {
  throw new Error(`Answer-position plan must be exactly balanced; found ${plannedPositions.join(',')}.`);
}

function validateReplacement(id, replacement) {
  for (const field of ['title', 'sourceType', 'source', 'attribution', 'genre', 'text']) {
    if (typeof replacement[field] !== 'string' || !replacement[field].trim()) {
      throw new Error(`${id}: replacement ${field} must be a non-empty string.`);
    }
  }
  if (!Number.isInteger(replacement.level) || replacement.level < 1 || replacement.level > 5) {
    throw new Error(`${id}: replacement level must be integer 1..5.`);
  }
  if (Object.hasOwn(replacement, 'releasedAt')
      && (typeof replacement.releasedAt !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(replacement.releasedAt))) {
    throw new Error(`${id}: replacement releasedAt must use yyyy-MM-dd.`);
  }
  const words = replacement.text.trim().split(/\s+/);
  if (replacement.wordCount !== words.length || words.length < 80 || words.length > 300) {
    throw new Error(`${id}: invalid replacement word count ${replacement.wordCount}/${words.length}.`);
  }
  const paragraphs = replacement.text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length < 2 || paragraphs.length > 4) {
    throw new Error(`${id}: replacement must contain 2..4 paragraphs; found ${paragraphs.length}.`);
  }

  const questions = replacement.questions;
  if (!Array.isArray(questions) || questions.length !== 4) {
    throw new Error(`${id}: replacement must contain exactly four questions.`);
  }
  const questionIds = new Set();
  const skills = new Set();
  for (const item of questions) {
    if (typeof item.id !== 'string' || questionIds.has(item.id)) throw new Error(`${id}: duplicate/invalid question ID.`);
    questionIds.add(item.id);
    if (!QUESTION_SKILLS.has(item.skill) || skills.has(item.skill)) throw new Error(`${id}/${item.id}: duplicate/invalid skill.`);
    skills.add(item.skill);
    if (typeof item.stem !== 'string' || !item.stem.trim()
        || typeof item.explanation !== 'string' || !item.explanation.trim()) {
      throw new Error(`${id}/${item.id}: stem and explanation must be non-empty.`);
    }
    if (!Array.isArray(item.choices) || item.choices.length !== 4
        || item.choices.some((choice) => typeof choice !== 'string' || !choice.trim())
        || new Set(item.choices.map((choice) => choice.trim().toLocaleLowerCase('en-US'))).size !== 4) {
      throw new Error(`${id}/${item.id}: choices must be four unique non-empty strings.`);
    }
    if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer > 3) {
      throw new Error(`${id}/${item.id}: answer must index one of four choices.`);
    }
    const choiceLengths = item.choices.map((choice) => choice.length);
    const longest = Math.max(...choiceLengths);
    if (choiceLengths[item.answer] === longest
        && choiceLengths.filter((length) => length === longest).length === 1) {
      throw new Error(`${id}/${item.id}: correct choice must not be the uniquely longest option.`);
    }
  }
  if (skills.size !== QUESTION_SKILLS.size) throw new Error(`${id}: replacement must cover all four skills.`);

  const value = replacement.lesson;
  if (!value || typeof value.strategy !== 'string' || !value.strategy.trim() || value.strategy.length > 320) {
    throw new Error(`${id}: lesson strategy is empty or over 320 characters.`);
  }
  if (!Array.isArray(value.signals) || value.signals.length < 2 || value.signals.length > 4) {
    throw new Error(`${id}: lesson must contain 2..4 signals.`);
  }
  const textFolded = replacement.text.toLocaleLowerCase('en-US');
  const paragraphFolded = paragraphs.map((part) => part.toLocaleLowerCase('en-US'));
  const signalKeys = new Set();
  for (const item of value.signals) {
    if (!item || typeof item.phrase !== 'string' || !item.phrase.trim() || item.phrase.length > 60
        || typeof item.means !== 'string' || !item.means.trim() || item.means.length > 120) {
      throw new Error(`${id}: invalid lesson signal.`);
    }
    const key = item.phrase.toLocaleLowerCase('en-US');
    if (signalKeys.has(key) || !textFolded.includes(key)
        || !paragraphFolded.some((paragraph) => paragraph.includes(key))) {
      throw new Error(`${id}: duplicate, ungrounded, or paragraph-split signal ${JSON.stringify(item.phrase)}.`);
    }
    signalKeys.add(key);
  }
  if (!Array.isArray(value.vocab) || value.vocab.length < 2 || value.vocab.length > 3) {
    throw new Error(`${id}: lesson must contain 2..3 vocabulary entries.`);
  }
  const vocabKeys = new Set();
  for (const item of value.vocab) {
    if (!item || typeof item.word !== 'string' || !item.word.trim()
        || typeof item.inContext !== 'string' || !item.inContext.trim() || item.inContext.length > 100) {
      throw new Error(`${id}: invalid vocabulary entry.`);
    }
    const key = item.word.toLocaleLowerCase('en-US');
    if (vocabKeys.has(key) || !textFolded.includes(key)) {
      throw new Error(`${id}: duplicate or ungrounded vocabulary word ${JSON.stringify(item.word)}.`);
    }
    vocabKeys.add(key);
  }
  if (!value.skillTips || new Set(Object.keys(value.skillTips)).size !== QUESTION_SKILLS.size
      || [...QUESTION_SKILLS].some((skill) => typeof value.skillTips[skill] !== 'string'
        || !value.skillTips[skill].trim() || value.skillTips[skill].length > 200)) {
    throw new Error(`${id}: lesson skillTips must contain the four non-empty recognized skills.`);
  }
}

const options = parseArgs(process.argv.slice(2));
const data = JSON.parse(readFileSync(options.input, 'utf8'));
if (data.schema !== 1 || ![11, 12].includes(data.version) || !Array.isArray(data.passages)) {
  throw new Error(`Expected schema=1, version=11/12 with passages; found schema=${data.schema}, version=${data.version}.`);
}
const passagesById = new Map(data.passages.map((passage) => [passage.id, passage]));
if (passagesById.size !== data.passages.length) throw new Error('Passage IDs must be unique.');
const legacyPassages = data.passages.filter((passage) => !YEAR_PACK_ID.test(passage.id));
if (legacyPassages.length !== EXPECTED_LEGACY_COUNT) {
  throw new Error(`Expected ${EXPECTED_LEGACY_COUNT} legacy passages, found ${legacyPassages.length}.`);
}
if (REPAIRS.size !== EXPECTED_SOURCE_DIGESTS.size
    || REPAIRS.size !== EXPECTED_INTERMEDIATE_DIGESTS.size
    || [...REPAIRS.keys()].some((id) =>
      !EXPECTED_SOURCE_DIGESTS.has(id) || !EXPECTED_INTERMEDIATE_DIGESTS.has(id))) {
  throw new Error('Repair targets and reviewed source/intermediate digests must match exactly.');
}

const beforeIds = data.passages.map((passage) => passage.id);
const beforeLevels = new Map(data.passages.map((passage) => [passage.id, passage.level]));
const beforeReleasedAt = new Map(data.passages.map((passage) => [passage.id, passage.releasedAt]));
const beforeQuestionIds = new Map(data.passages.map((passage) => [
  passage.id, passage.questions.map((item) => item.id),
]));
const targetIds = new Set(REPAIRS.keys());
const beforeNonTargets = new Map(data.passages
  .filter((passage) => !targetIds.has(passage.id))
  .map((passage) => [passage.id, JSON.stringify(passage)]));
const changes = [];
const unchanged = [];

for (const [id, repair] of REPAIRS) {
  if (!Array.isArray(repair.sources) || repair.sources.length === 0) throw new Error(`${id}: sources are required.`);
  validateReplacement(id, repair.replacement);
  const passage = passagesById.get(id);
  if (!passage) throw new Error(`Required passage is missing: ${id}.`);
  if (passage.level !== repair.replacement.level || passage.genre !== repair.replacement.genre) {
    throw new Error(`${id}: replacement must preserve level and genre.`);
  }
  const sourceQuestionIds = passage.questions.map((item) => item.id);
  const desiredQuestionIds = repair.replacement.questions.map((item) => item.id);
  if (JSON.stringify(sourceQuestionIds) !== JSON.stringify(desiredQuestionIds)) {
    throw new Error(`${id}: replacement must preserve question IDs and order.`);
  }

  const desired = replacementPassage(id, repair.replacement);
  const repairedDigest = completeDigest(desired);
  const currentCompleteDigest = completeDigest(passage);
  if (currentCompleteDigest === repairedDigest) {
    unchanged.push(id);
  } else {
    const beforeDigest = sourceDigest(passage);
    if (beforeDigest !== EXPECTED_SOURCE_DIGESTS.get(id)
        && currentCompleteDigest !== EXPECTED_INTERMEDIATE_DIGESTS.get(id)) {
      throw new Error(
        `${id}: complete/source digests ${currentCompleteDigest}/${beforeDigest} ` +
        'are not an exact reviewed source, intermediate, or repaired state.',
      );
    }
    applyReplacement(passage, desired);
    changes.push(id);
  }
}

if (JSON.stringify(data.passages.map((passage) => passage.id)) !== JSON.stringify(beforeIds)) {
  throw new Error('Passage ID/order invariant failed.');
}
for (const passage of data.passages) {
  if (passage.level !== beforeLevels.get(passage.id)) throw new Error(`${passage.id}: level invariant failed.`);
  if (passage.releasedAt !== beforeReleasedAt.get(passage.id)) {
    throw new Error(`${passage.id}: releasedAt invariant failed.`);
  }
  if (JSON.stringify(passage.questions.map((item) => item.id)) !== JSON.stringify(beforeQuestionIds.get(passage.id))) {
    throw new Error(`${passage.id}: question ID/order invariant failed.`);
  }
  if (!targetIds.has(passage.id) && JSON.stringify(passage) !== beforeNonTargets.get(passage.id)) {
    throw new Error(`${passage.id}: non-target passage changed.`);
  }
  if (passage.wordCount !== passage.text.trim().split(/\s+/).length) {
    throw new Error(`${passage.id}: wordCount does not match text.`);
  }
}

if (!options.dryRun) writeFileSync(options.output, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({
  mode: options.dryRun ? 'dry-run' : 'write',
  schema: data.schema,
  version: data.version,
  passageCount: data.passages.length,
  legacyPassageCount: legacyPassages.length,
  targetCount: REPAIRS.size,
  changedCount: changes.length,
  unchangedCount: unchanged.length,
  changedIds: changes,
  invariants: {
    passageIdsAndOrderPreserved: true,
    questionIdsAndOrderPreserved: true,
    levelsAndGenresPreserved: true,
    releasedAtPreserved: true,
    nonTargetPassagesPreserved: true,
  },
}, null, 2));
