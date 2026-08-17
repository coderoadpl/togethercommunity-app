import { and, eq, sql } from 'drizzle-orm';

import { createAuth } from '#adapters/auth/create-auth.js';
import type { AccessItem, Chapter, LessonBlock, ProductType } from '#core/domain/index.js';

import { createDb } from './client.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import { SAMPLE_LESSON_PDF_URL } from './sample-assets.js';
import {
  account,
  campaigns,
  campaignSends,
  courseLessons,
  courseModules,
  courses,
  consentConfirmationTokens,
  consentDefinitions,
  consentDefinitionVersions,
  couponCheckoutSessions,
  couponEvents,
  couponRedemptionEvents,
  couponRedemptions,
  coupons,
  emailEvents,
  emailOutbox,
  memberCourseProgress,
  memberEvents,
  members,
  memberSubscriptions,
  marketingConsents,
  notifications,
  orders,
  postReactions,
  postReportEvents,
  postReports,
  posts,
  productGrants,
  productDownloadAssets,
  productPrices,
  products,
  schedulerRuns,
  schedulerRunTenants,
  spaces,
  spaceSubscriptions,
  tenantAdmins,
  tenantDomains,
  tenantDocuments,
  tenantDocumentVersions,
  tenants,
  threadSubscriptions,
  unsubscribeTokens,
  user,
} from './schema.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const db = createDb('node-postgres', connectionString);
const seedIds = { nextId: () => crypto.randomUUID() };

const PASSWORD = 'demo-password-15';

/**
 * SEED_BASE_TIME (ISO timestamp) pins all relative seed dates, so the visual
 * regression harness gets identical rendered dates on every run.
 */
const parseBaseTime = (): number => {
  const raw = process.env['SEED_BASE_TIME'];
  if (raw === undefined) return Date.now();
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) throw new Error(`SEED_BASE_TIME is not a valid timestamp: ${raw}`);
  return parsed;
};

const baseTime = parseBaseTime();
let sequence = 0;
const nextIso = (): string => new Date(baseTime + sequence++ * 1000).toISOString();
const seedClock = { nowIso: () => new Date(baseTime).toISOString() };

const auth = createAuth(db, {
  secret: process.env['BETTER_AUTH_SECRET'] ?? 'dev-only-secret-do-not-use-in-prod',
  baseUrl: 'http://localhost:48730',
  baseDomain: 'localhost',
  singleTenantMode: false,
  trustedOrigins: () => ['http://localhost:48730'],
  secureCookies: false,
  exposeMagicLinks: false,
  emailOutbox: createEmailOutboxRepository(db),
  ids: seedIds,
  clock: seedClock,
  dispatchEmail: () => undefined,
  defaultTenantName: 'Together',
  google: null,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const relativeIso = (days: number): string => new Date(baseTime + days * DAY_MS).toISOString();

interface CreatorSpec {
  email: string;
  name: string;
  tenant: { id: string; slug: string; name: string };
}

const creators: CreatorSpec[] = [
  {
    email: 'creator@together.dev',
    name: 'Studio Creator',
    tenant: { id: 'tenant-studio', slug: 'studio', name: 'Studio Demo' },
  },
  {
    email: 'creator2@together.dev',
    name: 'Acme Creator',
    tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme Courses' },
  },
  {
    email: 'creator3@together.dev',
    name: 'Akademia Creator',
    tenant: { id: 'tenant-akademia', slug: 'akademia', name: 'Akademia Samouka' },
  },
];

const ensureCreator = async (email: string, name: string): Promise<string> => {
  const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (existing.length === 0) {
    await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
  } else {
    const password = await (await auth.$context).password.hash(PASSWORD);
    await db
      .update(account)
      .set({ password })
      .where(and(
        eq(account.userId, existing[0]?.id ?? ''),
        eq(account.providerId, 'credential'),
      ));
  }
  const [row] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!row) throw new Error(`Seeded creator not found: ${email}`);
  const seededAt = new Date(seedClock.nowIso());
  await db.update(user).set({ emailVerified: true, createdAt: seededAt, updatedAt: seededAt }).where(eq(user.id, row.id));
  await db.update(account).set({ createdAt: seededAt, updatedAt: seededAt }).where(eq(account.userId, row.id));
  return row.id;
};

const ensurePasswordlessUser = async (id: string, email: string, name: string): Promise<string> => {
  const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
  const found = existing[0];
  const now = new Date(seedClock.nowIso());
  if (found) {
    await db.update(user).set({ createdAt: now, updatedAt: now }).where(eq(user.id, found.id));
    return found.id;
  }
  await db
    .insert(user)
    .values({ id, name, email, emailVerified: true, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: user.email });
  const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Seeded member user not found: ${email}`);
  return row.id;
};

const embed = (videoId: string): LessonBlock => ({
  type: 'embed',
  embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
});
const html = (body: string): LessonBlock => ({ type: 'html', html: body });
const link = (url: string, description: string): LessonBlock => ({ type: 'link', url, description });
const pdf = (pdfUrl: string, name: string): LessonBlock => ({ type: 'pdf', pdfUrl, name });
const video = (streamLibraryId: string, streamVideoId: string): LessonBlock => ({
  type: 'video',
  storageKey: `${streamLibraryId}/${streamVideoId}`,
  streamVideoId,
  streamLibraryId,
});

// Publicly embeddable Bunny Stream demo (the player bunny.net embeds on its own
// marketing blog); renders for anyone via iframe.mediadelivery.net/embed/<lib>/<video>.
const BUNNY_DEMO_LIBRARY_ID = '197133';
const BUNNY_DEMO_VIDEO_ID = 'dc48a09e-d9bb-420a-83d7-72dc2304c034';

const SAMPLE_PDF = SAMPLE_LESSON_PDF_URL;

const STUDIO_BILLING_PORTAL_URL = 'https://billing.stripe.com/p/login/test_example';

interface LessonDef {
  id: string;
  durationMinutes: number;
  name: string;
  contents: LessonBlock[];
}

const studioLessons: LessonDef[] = [
  {
    id: 'lesson-js-demo-video',
    durationMinutes: 4,
    name: 'Demo wideo (Bunny Stream)',
    contents: [
      video(BUNNY_DEMO_LIBRARY_ID, BUNNY_DEMO_VIDEO_ID),
      html(
        '<h3>Odtwarzacz wideo Bunny Stream</h3><p>Ta lekcja pokazuje prawdziwy strumień wideo z Bunny Stream osadzony w odtwarzaczu platformy. Materiały wideo w Together serwujemy przez Bunny Stream — szybki, globalny hosting wideo z adaptacyjną jakością (HLS).</p><p>Aby dodać własne nagranie, wgraj je do swojej biblioteki Bunny Stream i wklej identyfikatory biblioteki oraz wideo w edytorze lekcji.</p>',
      ),
    ],
  },
  {
    id: 'lesson-js-zmienne-1',
    durationMinutes: 12,
    name: 'Deklarowanie zmiennych',
    contents: [
      embed('W6NZfCO5SIk'),
      html(
        '<h3>Zmienne w JavaScript</h3><p>W JavaScript zmienne deklarujemy słowami kluczowymi <code>let</code>, <code>const</code> oraz historycznym <code>var</code>. W nowoczesnym kodzie sięgamy niemal wyłącznie po dwa pierwsze.</p><ul><li><strong>const</strong> — wartość, której nie zamierzamy nadpisywać.</li><li><strong>let</strong> — zmienna, której wartość będzie się zmieniać w czasie.</li></ul><p>Dobrą praktyką jest domyślne używanie <code>const</code> i sięganie po <code>let</code> dopiero wtedy, gdy naprawdę musimy przypisać nową wartość.</p>',
      ),
      link(
        'https://developer.mozilla.org/pl/docs/Web/JavaScript/Guide/Grammar_and_types',
        'MDN — gramatyka i typy w JavaScript',
      ),
    ],
  },
  {
    id: 'lesson-js-zmienne-2',
    durationMinutes: 15,
    name: 'Typy proste i złożone',
    contents: [
      html(
        '<h3>Typy danych</h3><p>JavaScript rozróżnia typy proste (<code>string</code>, <code>number</code>, <code>boolean</code>, <code>null</code>, <code>undefined</code>, <code>symbol</code>, <code>bigint</code>) oraz typy złożone, czyli obiekty i tablice.</p><p>Typy proste przekazywane są przez wartość, a obiekty przez referencję. To fundamentalna różnica, którą warto zrozumieć na początku nauki.</p>',
      ),
      embed('hdI2bqOjy3c'),
    ],
  },
  {
    id: 'lesson-js-funkcje-1',
    durationMinutes: 18,
    name: 'Funkcje i argumenty',
    contents: [
      embed('N8ap4k_1QEQ'),
      html(
        '<h3>Funkcje</h3><p>Funkcja to fragment kodu, który możemy wielokrotnie wywoływać. W JavaScript funkcje są <strong>wartościami pierwszej klasy</strong> — możemy je przypisywać do zmiennych i przekazywać jako argumenty.</p><ul><li>Deklaracja funkcji: <code>function suma(a, b) { return a + b; }</code></li><li>Funkcja strzałkowa: <code>const suma = (a, b) =&gt; a + b;</code></li></ul>',
      ),
    ],
  },
  {
    id: 'lesson-js-funkcje-2',
    durationMinutes: 22,
    name: 'Domknięcia i zakres',
    contents: [
      html(
        '<h3>Domknięcia (closures)</h3><p>Domknięcie powstaje, gdy funkcja zapamiętuje zmienne z zakresu, w którym została utworzona. To jeden z najważniejszych mechanizmów języka.</p><p>Domknięcia wykorzystujemy między innymi do tworzenia liczników, funkcji pomocniczych oraz w programowaniu funkcyjnym.</p>',
      ),
      link('https://github.com/getify/You-Dont-Know-JS', 'You Dont Know JS — darmowa seria książek o JavaScript'),
    ],
  },
  {
    id: 'lesson-js-dom-1',
    durationMinutes: 14,
    name: 'Wybieranie elementów DOM',
    contents: [
      embed('0ik6X4DJKCc'),
      html(
        '<h3>Drzewo DOM</h3><p>DOM (Document Object Model) to reprezentacja strony w postaci drzewa węzłów. Elementy wybieramy metodami <code>querySelector</code> oraz <code>querySelectorAll</code>.</p><ul><li><code>document.querySelector(&quot;.klasa&quot;)</code> — pierwszy pasujący element.</li><li><code>document.querySelectorAll(&quot;li&quot;)</code> — lista wszystkich elementów.</li></ul>',
      ),
      pdf(SAMPLE_PDF, 'Ściąga: metody DOM (PDF)'),
    ],
  },
  {
    id: 'lesson-js-dom-2',
    durationMinutes: 19,
    name: 'Zdarzenia i interakcja',
    contents: [
      html(
        '<h3>Obsługa zdarzeń</h3><p>Interaktywność strony budujemy, nasłuchując zdarzeń metodą <code>addEventListener</code>. Do najczęstszych zdarzeń należą <code>click</code>, <code>input</code> oraz <code>submit</code>.</p><p>Pamiętaj o tym, by przy formularzach wywołać <code>event.preventDefault()</code>, jeśli chcesz przejąć kontrolę nad domyślnym zachowaniem przeglądarki.</p>',
      ),
      embed('jS4aFq5-91M'),
      link('https://developer.mozilla.org/pl/docs/Web/API/EventTarget/addEventListener', 'MDN — addEventListener'),
    ],
  },
  {
    id: 'lesson-js-projekt-1',
    durationMinutes: 35,
    name: 'Projekt: lista zadań',
    contents: [
      embed('8dWL3wF_OMw'),
      html(
        '<h3>Projekt końcowy</h3><p>W tej lekcji łączymy zdobytą wiedzę i budujemy prostą aplikację listy zadań (to-do). Wykorzystamy manipulację DOM, obsługę zdarzeń oraz zapisywanie stanu w <code>localStorage</code>.</p><ul><li>Dodawanie i usuwanie zadań.</li><li>Oznaczanie zadań jako ukończone.</li><li>Trwałość danych po odświeżeniu strony.</li></ul>',
      ),
      link('https://github.com/coderoad/todo-vanilla', 'Repozytorium startowe projektu na GitHub'),
    ],
  },
  {
    id: 'lesson-react-jsx-1',
    durationMinutes: 11,
    name: 'Czym jest JSX',
    contents: [
      embed('SqcY0GlETPk'),
      html(
        '<h3>Składnia JSX</h3><p>JSX pozwala pisać strukturę interfejsu w składni przypominającej HTML bezpośrednio w kodzie JavaScript. Pod spodem JSX kompiluje się do wywołań <code>React.createElement</code>.</p><p>Każdy komponent zwraca dokładnie jedno drzewo elementów — jeśli potrzebujesz zwrócić kilka elementów obok siebie, użyj fragmentu <code>&lt;&gt;...&lt;/&gt;</code>.</p>',
      ),
      link('https://react.dev/learn/writing-markup-with-jsx', 'Dokumentacja React — pisanie znaczników w JSX'),
    ],
  },
  {
    id: 'lesson-react-jsx-2',
    durationMinutes: 16,
    name: 'Komponenty i propsy',
    contents: [
      html(
        '<h3>Komponenty</h3><p>Komponent to funkcja zwracająca JSX. Dane przekazujemy do komponentu przez <strong>propsy</strong> — argumenty tylko do odczytu.</p><ul><li>Nazwy komponentów piszemy wielką literą.</li><li>Propsy są niemutowalne — komponent nigdy nie powinien ich modyfikować.</li></ul>',
      ),
      embed('Rh3tobg7hEo'),
    ],
  },
  {
    id: 'lesson-react-state-1',
    durationMinutes: 14,
    name: 'Stan komponentu z useState',
    contents: [
      embed('O6P86uwfdR0'),
      html(
        '<h3>Hook useState</h3><p>Stan to dane, które zmieniają się w czasie życia komponentu. Zarządzamy nim hookiem <code>useState</code>, który zwraca parę: aktualną wartość oraz funkcję ustawiającą.</p><p>Aktualizacja stanu powoduje ponowne wyrenderowanie komponentu z nowymi danymi.</p>',
      ),
      link('https://react.dev/reference/react/useState', 'Dokumentacja React — useState'),
    ],
  },
  {
    id: 'lesson-react-state-2',
    durationMinutes: 17,
    name: 'Przepływ danych i podnoszenie stanu',
    contents: [
      html(
        '<h3>Podnoszenie stanu (lifting state up)</h3><p>Gdy kilka komponentów potrzebuje tych samych danych, przenosimy stan do ich wspólnego rodzica i przekazujemy go w dół przez propsy. To podstawowy wzorzec przepływu danych w React.</p>',
      ),
      embed('bMknfKXIFA8'),
    ],
  },
  {
    id: 'lesson-react-hooks-1',
    durationMinutes: 21,
    name: 'Efekty uboczne z useEffect',
    contents: [
      embed('0ZJgIjIuY7U'),
      html(
        '<h3>Hook useEffect</h3><p>Efekty uboczne — pobieranie danych, subskrypcje, ręczna manipulacja DOM — obsługujemy hookiem <code>useEffect</code>. Tablica zależności decyduje, kiedy efekt zostanie ponownie uruchomiony.</p><ul><li>Pusta tablica <code>[]</code> — efekt uruchamia się raz, po zamontowaniu.</li><li>Funkcja czyszcząca zwracana z efektu sprząta po sobie przy odmontowaniu.</li></ul>',
      ),
      link('https://react.dev/reference/react/useEffect', 'Dokumentacja React — useEffect'),
    ],
  },
  {
    id: 'lesson-react-hooks-2',
    durationMinutes: 25,
    name: 'Tworzenie własnych hooków',
    contents: [
      html(
        '<h3>Custom hooks</h3><p>Powtarzalną logikę stanową wydzielamy do własnych hooków — zwykłych funkcji, których nazwa zaczyna się od <code>use</code>. Dzięki temu logika jest współdzielona między komponentami bez duplikacji kodu.</p>',
      ),
      embed('6ThXsUwLWvc'),
      link('https://github.com/streamich/react-use', 'react-use — biblioteka gotowych hooków (GitHub)'),
    ],
  },
];

const akademiaLessons: LessonDef[] = [
  {
    id: 'lesson-akademia-1-1',
    durationMinutes: 9,
    name: 'Jak uczyć się programowania',
    contents: [
      embed('zOjov-2OZ0E'),
      html(
        '<h3>Nauka od zera</h3><p>Samodzielna nauka programowania to maraton, nie sprint. Kluczem jest regularność oraz praca nad małymi, ukończonymi projektami.</p><ul><li>Ucz się codziennie, choćby przez pół godziny.</li><li>Pisz kod samodzielnie — czytanie nie wystarczy.</li><li>Nie bój się błędów; to one najwięcej uczą.</li></ul>',
      ),
      link('https://roadmap.sh', 'roadmap.sh — ścieżki nauki dla programistów'),
    ],
  },
  {
    id: 'lesson-akademia-1-2',
    durationMinutes: 13,
    name: 'Narzędzia i środowisko pracy',
    contents: [
      html(
        '<h3>Środowisko pracy</h3><p>Zanim zaczniesz pisać kod, warto skonfigurować wygodne środowisko: edytor (np. VS Code), terminal oraz system kontroli wersji <code>git</code>.</p><p>Dobre narzędzia nie napiszą kodu za Ciebie, ale znacząco przyspieszą pracę i naukę.</p>',
      ),
      embed('pQN-pnXPaVg'),
    ],
  },
  {
    id: 'lesson-akademia-2-1',
    durationMinutes: 24,
    name: 'Ćwiczenia praktyczne',
    contents: [
      embed('rfscVS0vtbw'),
      html(
        '<h3>Praktyka czyni mistrza</h3><p>Rozwiązywanie zadań algorytmicznych oraz budowanie własnych projektów to najlepszy sposób na utrwalenie wiedzy. Zacznij od prostych ćwiczeń i stopniowo zwiększaj poziom trudności.</p>',
      ),
      pdf(SAMPLE_PDF, 'Zestaw ćwiczeń (PDF)'),
    ],
  },
  {
    id: 'lesson-akademia-2-2',
    durationMinutes: 10,
    name: 'Budowanie portfolio',
    contents: [
      html(
        '<h3>Portfolio</h3><p>Ukończone projekty warto publikować na GitHub i prezentować w portfolio. To one, a nie certyfikaty, najlepiej świadczą o Twoich umiejętnościach przed pracodawcą.</p>',
      ),
      link('https://github.com', 'GitHub — miejsce na Twoje projekty'),
    ],
  },
];

interface ModuleDef {
  id: string;
  courseId: string;
  title: string;
  prefix: string;
  chapters: Chapter[];
}

const content = (lessonId: string, name: string): Chapter['contents'][number] => ({
  id: `content-${lessonId}`,
  name,
  lessonId,
});

const studioModules: ModuleDef[] = [
  {
    id: 'module-js-podstawy',
    courseId: 'course-js',
    prefix: 'Część 1',
    title: 'Podstawy',
    chapters: [
      {
        id: 'chapter-js-demo',
        name: 'Wprowadzenie',
        contents: [content('lesson-js-demo-video', 'Demo wideo (Bunny Stream)')],
      },
      {
        id: 'chapter-js-zmienne',
        name: 'Zmienne i typy',
        contents: [
          content('lesson-js-zmienne-1', 'Deklarowanie zmiennych'),
          content('lesson-js-zmienne-2', 'Typy proste i złożone'),
        ],
      },
      {
        id: 'chapter-js-funkcje',
        name: 'Funkcje',
        contents: [
          content('lesson-js-funkcje-1', 'Funkcje i argumenty'),
          content('lesson-js-funkcje-2', 'Domknięcia i zakres'),
        ],
      },
    ],
  },
  {
    id: 'module-js-dom',
    courseId: 'course-js',
    prefix: 'Część 2',
    title: 'DOM',
    chapters: [
      {
        id: 'chapter-js-dom',
        name: 'Manipulacja DOM',
        contents: [
          content('lesson-js-dom-1', 'Wybieranie elementów DOM'),
          content('lesson-js-dom-2', 'Zdarzenia i interakcja'),
        ],
      },
    ],
  },
  {
    id: 'module-js-projekty',
    courseId: 'course-js',
    prefix: 'Część 3',
    title: 'Projekty',
    chapters: [
      {
        id: 'chapter-js-projekty',
        name: 'Projekt końcowy',
        contents: [content('lesson-js-projekt-1', 'Projekt: lista zadań')],
      },
    ],
  },
  {
    id: 'module-react-fundamenty',
    courseId: 'course-react',
    prefix: 'Część 1',
    title: 'Fundamenty',
    chapters: [
      {
        id: 'chapter-react-jsx',
        name: 'JSX i komponenty',
        contents: [
          content('lesson-react-jsx-1', 'Czym jest JSX'),
          content('lesson-react-jsx-2', 'Komponenty i propsy'),
        ],
      },
      {
        id: 'chapter-react-state',
        name: 'Stan i propsy',
        contents: [
          content('lesson-react-state-1', 'Stan komponentu z useState'),
          content('lesson-react-state-2', 'Przepływ danych i podnoszenie stanu'),
        ],
      },
    ],
  },
  {
    id: 'module-react-zaawansowane',
    courseId: 'course-react',
    prefix: 'Część 2',
    title: 'Zaawansowane wzorce',
    chapters: [
      {
        id: 'chapter-react-hooks',
        name: 'Custom hooks',
        contents: [
          content('lesson-react-hooks-1', 'Efekty uboczne z useEffect'),
          content('lesson-react-hooks-2', 'Tworzenie własnych hooków'),
        ],
      },
    ],
  },
];

const akademiaModules: ModuleDef[] = [
  {
    id: 'module-akademia-1',
    courseId: 'course-akademia',
    prefix: 'Część 1',
    title: 'Nauka od zera',
    chapters: [
      {
        id: 'chapter-akademia-1',
        name: 'Pierwsze kroki',
        contents: [
          content('lesson-akademia-1-1', 'Jak uczyć się programowania'),
          content('lesson-akademia-1-2', 'Narzędzia i środowisko pracy'),
        ],
      },
    ],
  },
  {
    id: 'module-akademia-2',
    courseId: 'course-akademia',
    prefix: 'Część 2',
    title: 'Praktyka',
    chapters: [
      {
        id: 'chapter-akademia-2',
        name: 'Ćwiczenia',
        contents: [
          content('lesson-akademia-2-1', 'Ćwiczenia praktyczne'),
          content('lesson-akademia-2-2', 'Budowanie portfolio'),
        ],
      },
    ],
  },
];

interface CourseDef {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  imageUrl: string;
  publiclyVisible?: boolean;
}

const courseDefs: CourseDef[] = [
  {
    id: 'course-js',
    tenantId: 'tenant-studio',
    name: 'Kurs JavaScript od podstaw',
    description: 'Kompletny kurs JavaScript: od zmiennych, przez funkcje i DOM, po pierwszy projekt.',
    imageUrl: 'https://picsum.photos/seed/together-course-js/960/540',
    publiclyVisible: true,
  },
  {
    id: 'course-react',
    tenantId: 'tenant-studio',
    name: 'React w praktyce',
    description: 'Budowanie interfejsów w React — komponenty, stan, hooki i zaawansowane wzorce.',
    imageUrl: 'https://picsum.photos/seed/together-course-react/960/540',
  },
  {
    id: 'course-akademia',
    tenantId: 'tenant-akademia',
    name: 'Samodzielna nauka programowania',
    description: 'Przewodnik po samodzielnej nauce programowania: metody, narzędzia i praktyka.',
    imageUrl: 'https://picsum.photos/seed/together-course-akademia/960/540',
  },
];

interface ProductDef {
  id: string;
  tenantId: string;
  type: ProductType;
  title: string;
  description: string;
  priceCents: number;
  accessItems: AccessItem[];
}

const demoProducts: ProductDef[] = [
  {
    id: 'product-js-full',
    tenantId: 'tenant-studio',
    type: 'course',
    title: 'Kurs JavaScript - pełny dostęp',
    description: 'Pełny dostęp do wszystkich modułów kursu JavaScript od podstaw.',
    priceCents: 39900,
    accessItems: [{ level: 'course', courseId: 'course-js' }],
  },
  {
    id: 'product-react-full',
    tenantId: 'tenant-studio',
    type: 'course',
    title: 'React w praktyce - pełny dostęp',
    description: 'Pełny dostęp do kursu React w praktyce.',
    priceCents: 49900,
    accessItems: [{ level: 'course', courseId: 'course-react' }],
  },
  {
    id: 'product-js-dom-module',
    tenantId: 'tenant-studio',
    type: 'course',
    title: 'Pakiet: moduł DOM',
    description: 'Dostęp wyłącznie do modułu DOM z kursu JavaScript.',
    priceCents: 9900,
    accessItems: [{ level: 'modules', courseId: 'course-js', moduleIds: ['module-js-dom'] }],
  },
  {
    id: 'product-free-preview',
    tenantId: 'tenant-studio',
    type: 'course',
    title: 'Free preview',
    description: 'Darmowa zajawka — po jednej lekcji z każdego modułu obu kursów.',
    priceCents: 0,
    accessItems: [
      {
        level: 'lessons',
        courseId: 'course-js',
        lessonIds: ['lesson-js-demo-video', 'lesson-js-zmienne-1', 'lesson-js-dom-1', 'lesson-js-projekt-1'],
      },
      {
        level: 'lessons',
        courseId: 'course-react',
        lessonIds: ['lesson-react-jsx-1', 'lesson-react-hooks-1'],
      },
    ],
  },
  {
    id: 'product-akademia-roczny',
    tenantId: 'tenant-akademia',
    type: 'course',
    title: 'Akademia - dostęp roczny',
    description: 'Roczny dostęp do kursu Samodzielna nauka programowania.',
    priceCents: 29900,
    accessItems: [{ level: 'course', courseId: 'course-akademia' }],
  },
  {
    id: 'product-club',
    tenantId: 'tenant-studio',
    type: 'membership',
    title: 'Klub Studio — subskrypcja',
    description: 'Abonament klubu: dostęp do kursów JavaScript i React, dopóki subskrypcja trwa.',
    priceCents: 4900,
    accessItems: [
      { level: 'course', courseId: 'course-js' },
      { level: 'course', courseId: 'course-react' },
    ],
  },
  {
    id: 'product-download-workbook',
    tenantId: 'tenant-studio',
    type: 'digital_download',
    title: 'Workbook twórcy',
    description: 'Ćwiczenia i checklisty do samodzielnej pracy po zakupie.',
    priceCents: 7900,
    accessItems: [],
  },
];

interface PriceDef {
  id: string;
  tenantId: string;
  productId: string;
  kind: 'one_time' | 'recurring';
  interval: 'month' | 'year' | null;
  amountCents: number;
}

const subscriptionPriceDefs: PriceDef[] = [
  {
    id: 'price-club-monthly',
    tenantId: 'tenant-studio',
    productId: 'product-club',
    kind: 'recurring',
    interval: 'month',
    amountCents: 4900,
  },
  {
    id: 'price-club-yearly',
    tenantId: 'tenant-studio',
    productId: 'product-club',
    kind: 'recurring',
    interval: 'year',
    amountCents: 49900,
  },
];

interface MemberSpec {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
}

interface GrantSpec {
  id: string;
  tenantId: string;
  memberId: string;
  productId: string;
  startsAt: string;
  expiresAt: string | null;
}

interface ProgressSpec {
  id: string;
  tenantId: string;
  memberId: string;
  courseId: string;
  completedLessonIds: string[];
  lastViewedLessonId?: string;
  lastViewedModuleId?: string;
  lastViewedChapterId?: string;
}

interface DemoMemberDef {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  grant: { id: string; productId: string; startsAt: string; expiresAt: string | null };
  progress?: Omit<ProgressSpec, 'id' | 'tenantId' | 'memberId'>;
}

const demoMemberDefs: DemoMemberDef[] = [
  {
    id: 'member-studio-aktywny',
    userId: 'user-kursant-aktywny',
    tenantId: 'tenant-studio',
    email: 'kursant.aktywny@together.dev',
    displayName: 'Kursant Aktywny',
    grant: {
      id: 'grant-studio-aktywny',
      productId: 'product-js-full',
      startsAt: relativeIso(-30),
      expiresAt: null,
    },
    progress: {
      courseId: 'course-js',
      completedLessonIds: ['lesson-js-zmienne-1', 'lesson-js-zmienne-2'],
      lastViewedLessonId: 'lesson-js-funkcje-1',
      lastViewedModuleId: 'module-js-podstawy',
      lastViewedChapterId: 'chapter-js-funkcje',
    },
  },
  {
    id: 'member-studio-wygasly',
    userId: 'user-kursant-wygasly',
    tenantId: 'tenant-studio',
    email: 'kursant.wygasly@together.dev',
    displayName: 'Kursant Wygasły',
    grant: {
      id: 'grant-studio-wygasly',
      productId: 'product-js-full',
      startsAt: relativeIso(-30),
      expiresAt: relativeIso(-7),
    },
  },
  {
    id: 'member-studio-przyszly',
    userId: 'user-kursant-przyszly',
    tenantId: 'tenant-studio',
    email: 'kursant.przyszly@together.dev',
    displayName: 'Kursant Przyszły',
    grant: {
      id: 'grant-studio-przyszly',
      productId: 'product-js-full',
      startsAt: relativeIso(7),
      expiresAt: relativeIso(372),
    },
  },
  {
    id: 'member-studio-modul',
    userId: 'user-kursant-modul',
    tenantId: 'tenant-studio',
    email: 'kursant.modul@together.dev',
    displayName: 'Kursant Modułowy',
    grant: {
      id: 'grant-studio-modul',
      productId: 'product-js-dom-module',
      startsAt: relativeIso(-14),
      expiresAt: null,
    },
  },
  {
    id: 'member-studio-free',
    userId: 'user-free',
    tenantId: 'tenant-studio',
    email: 'free@together.dev',
    displayName: 'Konto Free',
    grant: {
      id: 'grant-studio-free',
      productId: 'product-free-preview',
      startsAt: relativeIso(-3),
      expiresAt: null,
    },
  },
  {
    id: 'member-studio-abonent',
    userId: 'user-kursant-abonent',
    tenantId: 'tenant-studio',
    email: 'kursant.abonent@together.dev',
    displayName: 'Kursant Abonent',
    grant: {
      id: 'grant-studio-abonent',
      productId: 'product-club',
      startsAt: relativeIso(-40),
      expiresAt: relativeIso(23),
    },
  },
  {
    id: 'member-akademia-kursant',
    userId: 'user-kursant-akademia',
    tenantId: 'tenant-akademia',
    email: 'kursant.akademia@together.dev',
    displayName: 'Kursant Akademii',
    grant: {
      id: 'grant-akademia-kursant',
      productId: 'product-akademia-roczny',
      startsAt: relativeIso(-5),
      expiresAt: relativeIso(330),
    },
    progress: {
      courseId: 'course-akademia',
      completedLessonIds: ['lesson-akademia-1-1'],
      lastViewedLessonId: 'lesson-akademia-1-2',
      lastViewedModuleId: 'module-akademia-1',
      lastViewedChapterId: 'chapter-akademia-1',
    },
  },
];

const creatorUserIds = new Map<string, string>();
for (const creator of creators) {
  const userId = await ensureCreator(creator.email, creator.name);
  creatorUserIds.set(creator.tenant.id, userId);
}

await db
  .insert(tenants)
  .values(creators.map((creator) => ({ ...creator.tenant, createdAt: nextIso() })))
  .onConflictDoNothing();

await db
  .update(tenants)
  .set({ billingPortalUrl: STUDIO_BILLING_PORTAL_URL, defaultHomeSpaceId: 'space-studio-spolecznosc' })
  .where(eq(tenants.id, 'tenant-studio'));

// Only akademia is branded; studio and acme stay on the stock look so the
// unbranded visual goldens keep proving the no-branding identity property.
await db
  .update(tenants)
  .set({
    logoUrl: '/assets/akademia-logo.svg',
    accentColor: '#0E7490',
    faviconUrl: '/assets/akademia-logo.svg',
  })
  .where(eq(tenants.id, 'tenant-akademia'));

await db
  .insert(tenantDocuments)
  .values({
    id: 'document-akademia-privacy', tenantId: 'tenant-akademia', slug: 'polityka-prywatnosci',
    title: 'Polityka prywatności', status: 'published', createdAt: relativeIso(-90), updatedAt: relativeIso(-30),
  })
  .onConflictDoNothing();

await db
  .insert(tenantDocumentVersions)
  .values({
    id: 'document-akademia-privacy-v1', tenantId: 'tenant-akademia', documentId: 'document-akademia-privacy', version: 1,
    content: '# Jak dbamy o Twoje dane\n\nSzanujemy Twoją prywatność i używamy danych wyłącznie do obsługi wybranych przez Ciebie usług.\n\n## Kontakt\n\nW sprawach dotyczących danych napisz na [privacy@akademia.test](mailto:privacy@akademia.test).\n\n- możesz wycofać zgodę w dowolnym momencie\n- każda zmiana jest zapisywana w historii zgód',
    publishedAt: relativeIso(-30), createdAt: relativeIso(-30), createdBy: null,
  })
  .onConflictDoNothing();

await db
  .insert(consentDefinitions)
  .values({
    id: 'consent-definition-akademia-news', tenantId: 'tenant-akademia', key: 'aktualnosci',
    kind: 'optional_marketing', channel: 'email', doubleOptIn: true,
    documentRef: { mode: 'hosted', documentId: 'document-akademia-privacy' }, status: 'active',
    createdAt: relativeIso(-25), updatedAt: relativeIso(-25),
  })
  .onConflictDoNothing();

await db
  .insert(consentDefinitionVersions)
  .values({
    id: 'consent-definition-akademia-news-v1', tenantId: 'tenant-akademia', definitionId: 'consent-definition-akademia-news', version: 1,
    label: 'Chcę otrzymywać aktualności i praktyczne materiały e-mailem',
    documentVersionRef: { mode: 'hosted', documentVersionId: 'document-akademia-privacy-v1' },
    createdAt: relativeIso(-25), createdBy: null,
  })
  .onConflictDoNothing();

await db
  .insert(consentDefinitions)
  .values({
    id: 'consent-definition-studio-news', tenantId: 'tenant-studio', key: 'aktualnosci',
    kind: 'optional_marketing', channel: 'email', doubleOptIn: true,
    documentRef: { mode: 'url', url: 'https://studio.example.test/privacy' }, status: 'active',
    createdAt: relativeIso(-25), updatedAt: relativeIso(-25),
  })
  .onConflictDoNothing();

await db
  .insert(consentDefinitionVersions)
  .values({
    id: 'consent-definition-studio-news-v1', tenantId: 'tenant-studio',
    definitionId: 'consent-definition-studio-news', version: 1,
    label: 'Chcę otrzymywać aktualności e-mailem',
    documentVersionRef: { mode: 'url', url: 'https://studio.example.test/privacy' },
    createdAt: relativeIso(-25), createdBy: null,
  })
  .onConflictDoNothing();

await db
  .insert(marketingConsents)
  .values([
    {
      id: 'marketing-consent-akademia-granted', tenantId: 'tenant-akademia', memberId: null,
      email: 'kursant.akademia@together.dev', definitionId: 'consent-definition-akademia-news', definitionVersion: 1,
      wordingSnapshot: 'Chcę otrzymywać aktualności i praktyczne materiały e-mailem',
      documentRefSnapshot: { mode: 'hosted', documentVersionId: 'document-akademia-privacy-v1' },
      status: 'granted', previousId: null, source: 'checkout',
      evidence: { collectedAt: relativeIso(-20), proofRef: 'seeded-checkout' }, occurredAt: relativeIso(-20),
    },
    {
      id: 'marketing-consent-akademia-confirmed', tenantId: 'tenant-akademia', memberId: null,
      email: 'kursant.akademia@together.dev', definitionId: 'consent-definition-akademia-news', definitionVersion: 1,
      wordingSnapshot: 'Chcę otrzymywać aktualności i praktyczne materiały e-mailem',
      documentRefSnapshot: { mode: 'hosted', documentVersionId: 'document-akademia-privacy-v1' },
      status: 'confirmed', previousId: 'marketing-consent-akademia-granted', source: 'checkout',
      evidence: { collectedAt: relativeIso(-19) }, occurredAt: relativeIso(-19),
    },
  ])
  .onConflictDoNothing();

await db
  .insert(unsubscribeTokens)
  .values({
    id: 'unsubscribe-akademia-visual', tenantId: 'tenant-akademia',
    token: 'unsubscribe_akademia_visual_123456', email: 'kursant.akademia@together.dev',
    memberId: null, campaignSendId: null, scope: 'consent:consent-definition-akademia-news',
    createdAt: relativeIso(-10), usedAt: null,
  })
  .onConflictDoNothing();

await db
  .insert(consentConfirmationTokens)
  .values({
    id: 'confirmation-akademia-visual', tenantId: 'tenant-akademia',
    token: 'confirmation_akademia_visual_123456', marketingConsentRowId: 'marketing-consent-akademia-granted',
    createdAt: relativeIso(-20), expiresAt: relativeIso(1), usedAt: relativeIso(-19),
  })
  .onConflictDoNothing();

await db
  .insert(tenantAdmins)
  .values(
    creators.map((creator) => ({
      id: `admin-${creator.tenant.slug}`,
      tenantId: creator.tenant.id,
      userId: creatorUserIds.get(creator.tenant.id) ?? '',
      role: 'owner' as const,
    })),
  )
  .onConflictDoNothing();

await db
  .insert(tenantDomains)
  .values(
    creators.map((creator) => ({
      id: `domain-${creator.tenant.slug}`,
      tenantId: creator.tenant.id,
      domain: `${creator.tenant.slug}.localhost`,
      kind: 'subdomain' as const,
      verified: true,
    })),
  )
  .onConflictDoNothing();

await db
  .insert(courses)
  .values(
    courseDefs.map((course) => ({
      id: course.id,
      tenantId: course.tenantId,
      name: course.name,
      description: course.description,
      imageUrl: course.imageUrl,
      publiclyVisible: course.publiclyVisible ?? false,
      createdAt: nextIso(),
    })),
  )
  .onConflictDoUpdate({
    target: [courses.tenantId, courses.id],
    set: {
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      imageUrl: sql`excluded.image_url`,
      publiclyVisible: sql`excluded.publicly_visible`,
    },
  });

const lessonTenant: Record<string, string> = {};
for (const lesson of studioLessons) lessonTenant[lesson.id] = 'tenant-studio';
for (const lesson of akademiaLessons) lessonTenant[lesson.id] = 'tenant-akademia';

await db
  .insert(courseLessons)
  .values(
    [...studioLessons, ...akademiaLessons].map((lesson) => ({
      id: lesson.id,
      tenantId: lessonTenant[lesson.id] ?? 'tenant-studio',
      name: lesson.name,
      isPreview: false,
      contents: lesson.contents,
      durationMinutes: lesson.durationMinutes,
      createdAt: nextIso(),
    })),
  )
  .onConflictDoUpdate({
    target: [courseLessons.tenantId, courseLessons.id],
    set: {
      name: sql`excluded.name`,
      isPreview: sql`excluded.is_preview`,
      contents: sql`excluded.contents`,
      durationMinutes: sql`excluded.duration_minutes`,
    },
  });

const moduleTenant: Record<string, string> = { 'course-js': 'tenant-studio', 'course-react': 'tenant-studio', 'course-akademia': 'tenant-akademia' };

await db
  .insert(courseModules)
  .values(
    [...studioModules, ...akademiaModules].map((module) => ({
      id: module.id,
      tenantId: moduleTenant[module.courseId] ?? 'tenant-studio',
      courseIds: [module.courseId],
      title: module.title,
      prefix: module.prefix,
      chapters: module.chapters,
      createdAt: nextIso(),
    })),
  )
  .onConflictDoUpdate({
    target: [courseModules.tenantId, courseModules.id],
    set: {
      courseIds: sql`excluded.course_ids`,
      title: sql`excluded.title`,
      prefix: sql`excluded.prefix`,
      chapters: sql`excluded.chapters`,
    },
  });

await db
  .insert(members)
  .values([
    {
      id: 'member-studio-student1',
      tenantId: 'tenant-studio',
      userId: 'student1-opaque',
      email: 'student1@together.dev',
      displayName: 'Student One',
      createdAt: nextIso(),
    },
    {
      id: 'member-acme-student2',
      tenantId: 'tenant-acme',
      userId: 'student2-opaque',
      email: 'student2@together.dev',
      displayName: 'Student Two',
      createdAt: nextIso(),
    },
  ])
  .onConflictDoNothing();

await db
  .insert(products)
  .values([
    {
      id: 'product-studio-kurs-101',
      tenantId: 'tenant-studio',
      type: 'course',
      slug: 'kurs-together-101',
      title: 'Kurs Together 101',
      description: '',
      priceCents: 19900,
      currency: 'PLN',
      published: true,
      accessItems: [],
      createdAt: nextIso(),
    },
    {
      id: 'product-studio-warsztat',
      tenantId: 'tenant-studio',
      type: 'course',
      slug: 'warsztat-scenariuszowy',
      title: 'Warsztat scenariuszowy',
      description: '',
      priceCents: 49900,
      currency: 'PLN',
      published: false,
      accessItems: [],
      createdAt: nextIso(),
    },
    {
      id: 'product-acme-course',
      tenantId: 'tenant-acme',
      type: 'course',
      slug: 'acme-course',
      title: 'Acme Course',
      description: '',
      priceCents: 9900,
      currency: 'PLN',
      published: true,
      accessItems: [],
      createdAt: nextIso(),
    },
  ])
  .onConflictDoNothing();

await db
  .insert(products)
  .values(
    demoProducts.map((product) => ({
      id: product.id,
      tenantId: product.tenantId,
      type: product.type,
      slug: product.id.replace(/^product-/, ''),
      title: product.title,
      description: product.description,
      priceCents: product.priceCents,
      currency: 'PLN',
      published: true,
      accessItems: product.accessItems,
      createdAt: nextIso(),
    })),
  )
  .onConflictDoUpdate({
    target: [products.tenantId, products.id],
    set: {
      title: sql`excluded.title`,
      description: sql`excluded.description`,
      priceCents: sql`excluded.price_cents`,
      published: sql`excluded.published`,
      accessItems: sql`excluded.access_items`,
    },
  });

const memberSpecs: MemberSpec[] = [];
const grantSpecs: GrantSpec[] = [];
const progressSpecs: ProgressSpec[] = [];

for (const def of demoMemberDefs) {
  const userId = await ensurePasswordlessUser(def.userId, def.email, def.displayName);
  memberSpecs.push({
    id: def.id,
    userId,
    tenantId: def.tenantId,
    email: def.email,
    displayName: def.displayName,
  });
  grantSpecs.push({
    id: def.grant.id,
    tenantId: def.tenantId,
    memberId: def.id,
    productId: def.grant.productId,
    startsAt: def.grant.startsAt,
    expiresAt: def.grant.expiresAt,
  });
  if (def.progress) {
    progressSpecs.push({
      id: `progress-${def.id}`,
      tenantId: def.tenantId,
      memberId: def.id,
      ...def.progress,
    });
  }
}

grantSpecs.push({
  id: 'grant-studio-aktywny-workbook',
  tenantId: 'tenant-studio',
  memberId: 'member-studio-aktywny',
  productId: 'product-download-workbook',
  startsAt: relativeIso(-12),
  expiresAt: null,
});

grantSpecs.push({
  id: 'grant-studio-aktywny-club',
  tenantId: 'tenant-studio',
  memberId: 'member-studio-aktywny',
  productId: 'product-club',
  startsAt: relativeIso(-20),
  expiresAt: relativeIso(40),
});

await db
  .insert(productDownloadAssets)
  .values({
    id: 'download-asset-workbook',
    tenantId: 'tenant-studio',
    productId: 'product-download-workbook',
    fileName: 'workbook-tworcy.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2_416_640,
    storageKey: 'product-downloads/product-download-workbook/download-asset-workbook/workbook-tworcy.pdf',
    status: 'ready',
    createdAt: relativeIso(-12),
  })
  .onConflictDoNothing();
await db
  .insert(members)
  .values(
    memberSpecs.map((member) => ({
      id: member.id,
      tenantId: member.tenantId,
      userId: member.userId,
      email: member.email,
      displayName: member.displayName,
      createdAt: nextIso(),
    })),
  )
  .onConflictDoNothing();

const seededBanAt = relativeIso(-2);
await db
  .update(members)
  .set({
    bannedAt: seededBanAt,
    bannedReason: 'Powtarzające się reklamy w społeczności',
    bannedByUserId: creatorUserIds.get('tenant-studio') ?? 'user-studio-creator',
  })
  .where(and(eq(members.tenantId, 'tenant-studio'), eq(members.id, 'member-studio-free')));
await db
  .insert(memberEvents)
  .values({
    id: 'member-event-studio-free-banned',
    tenantId: 'tenant-studio',
    memberId: 'member-studio-free',
    type: 'banned',
    payload: {
      reason: 'Powtarzające się reklamy w społeczności',
      actorUserId: creatorUserIds.get('tenant-studio') ?? 'user-studio-creator',
    },
    occurredAt: seededBanAt,
  })
  .onConflictDoNothing();

await db
  .insert(marketingConsents)
  .values({
    id: 'marketing-consent-studio-confirmed', tenantId: 'tenant-studio',
    memberId: 'member-studio-aktywny', email: 'kursant.aktywny@together.dev',
    definitionId: 'consent-definition-studio-news', definitionVersion: 1,
    wordingSnapshot: 'Chcę otrzymywać aktualności e-mailem',
    documentRefSnapshot: { mode: 'url', url: 'https://studio.example.test/privacy' },
    status: 'confirmed', previousId: null, source: 'checkout',
    evidence: { collectedAt: relativeIso(-20), proofRef: 'seeded-checkout' },
    occurredAt: relativeIso(-20),
  })
  .onConflictDoNothing();

await db
  .insert(campaigns)
  .values({
    id: 'campaign-studio-observability', tenantId: 'tenant-studio', name: 'Premiera kursu',
    subject: 'Twój plan nauki na lipiec', bodyHtml: '<p>Plan nauki</p>', bodySource: '<p>Plan nauki</p>',
    layoutId: null, consentDefinitionId: 'consent-definition-studio-news', audienceFilter: null,
    status: 'finished', sendAt: relativeIso(-4), snapshotMaxMemberId: 'member-studio-aktywny',
    cursorMemberId: 'member-studio-aktywny', toSend: 1, sent: 1, failed: 0,
    lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null,
    audienceNameSnapshot: 'Wszyscy uprawnieni', consentLabelSnapshot: 'Chcę otrzymywać aktualności e-mailem',
    startedAt: relativeIso(-4), finishedAt: relativeIso(-4), createdAt: relativeIso(-5),
  })
  .onConflictDoNothing();

await db
  .insert(schedulerRuns)
  .values([
    {
      id: 'scheduler-run-studio-marketing', kind: 'marketing_tick', trigger: 'cron',
      startedAt: relativeIso(-0.1), finishedAt: relativeIso(-0.1), durationMs: 684,
      status: 'completed', error: null,
      totals: {
        campaignsTouched: 1, sendsAttempted: 1, sent: 1, failed: 0, skipped: 0, reEnqueued: false,
      },
      createdAt: relativeIso(-0.1),
    },
    {
      id: 'scheduler-run-studio-outbox', kind: 'outbox_dispatch', trigger: 'cron',
      startedAt: relativeIso(-0.2), finishedAt: relativeIso(-0.2), durationMs: 312,
      status: 'failed', error: 'SES rejected one message',
      totals: {
        campaignsTouched: 0, sendsAttempted: 2, sent: 1, failed: 1, skipped: 0, reEnqueued: false,
      },
      createdAt: relativeIso(-0.2),
    },
  ])
  .onConflictDoNothing();

await db
  .insert(schedulerRunTenants)
  .values([
    {
      id: 'scheduler-run-tenant-studio-marketing', runId: 'scheduler-run-studio-marketing',
      tenantId: 'tenant-studio', campaignsTouched: 1, batchSize: 1, sent: 1, failed: 0, skipped: 0,
      budgetComputed: 25, budgetUsed: 1, errors: [], createdAt: relativeIso(-0.1),
    },
    {
      id: 'scheduler-run-tenant-studio-outbox', runId: 'scheduler-run-studio-outbox',
      tenantId: 'tenant-studio', campaignsTouched: 0, batchSize: 2, sent: 1, failed: 1, skipped: 0,
      budgetComputed: 25, budgetUsed: 2, errors: ['SES rejected one message'], createdAt: relativeIso(-0.2),
    },
  ])
  .onConflictDoNothing();

await db
  .insert(campaignSends)
  .values({
    id: 'send-studio-marketing', tenantId: 'tenant-studio', campaignId: 'campaign-studio-observability',
    runId: 'scheduler-run-studio-marketing',
    source: 'broadcast', memberId: 'member-studio-aktywny', email: 'kursant.aktywny@together.dev',
    subject: 'Twój plan nauki na lipiec', consentRowId: 'marketing-consent-studio-confirmed',
    unsubscribeTokenId: null, status: 'sent', skipReason: null, sesMessageId: 'ses-studio-marketing',
    deliveryStatus: 'delivered', deliveryOccurredAt: relativeIso(-4), idempotencySource: null,
    renderedBodyPurgedAt: null, createdAt: relativeIso(-4), sentAt: relativeIso(-4),
  })
  .onConflictDoNothing();

await db
  .insert(emailOutbox)
  .values({
    id: 'send-studio-transactional', tenantId: 'tenant-studio', kind: 'welcome-sign-in',
    to: 'kursant.aktywny@together.dev',
    payload: {
      kind: 'welcome-sign-in', language: 'pl', tenantName: 'Studio Demo',
      actionUrl: 'https://studio.example.test/sign-in',
    },
    status: 'sent', attempts: 1, nextAttemptAt: relativeIso(-3), lastError: null,
    createdAt: relativeIso(-3), sentAt: relativeIso(-3), sesMessageId: 'ses-studio-transactional',
    deliveryStatus: null, deliveryOccurredAt: null,
  })
  .onConflictDoNothing();

await db
  .insert(emailEvents)
  .values([
    {
      id: 'event-studio-marketing-queued', tenantId: 'tenant-studio', mailKind: 'marketing',
      refId: 'send-studio-marketing', type: 'queued', occurredAt: relativeIso(-4),
      meta: { source: 'broadcast', runId: 'scheduler-run-studio-marketing' }, createdAt: relativeIso(-4),
    },
    {
      id: 'event-studio-marketing-accepted', tenantId: 'tenant-studio', mailKind: 'marketing',
      refId: 'send-studio-marketing', type: 'accepted', occurredAt: relativeIso(-4),
      meta: { sesMessageId: 'ses-studio-marketing' }, createdAt: relativeIso(-4),
    },
    {
      id: 'event-studio-marketing-delivered', tenantId: 'tenant-studio', mailKind: 'marketing',
      refId: 'send-studio-marketing', type: 'delivered', occurredAt: relativeIso(-4),
      meta: { processingTimeMillis: 842 }, createdAt: relativeIso(-4),
    },
    {
      id: 'event-studio-transactional-queued', tenantId: 'tenant-studio', mailKind: 'transactional',
      refId: 'send-studio-transactional', type: 'queued', occurredAt: relativeIso(-3),
      meta: null, createdAt: relativeIso(-3),
    },
    {
      id: 'event-studio-transactional-accepted', tenantId: 'tenant-studio', mailKind: 'transactional',
      refId: 'send-studio-transactional', type: 'accepted', occurredAt: relativeIso(-3),
      meta: { sesMessageId: 'ses-studio-transactional', runId: 'scheduler-run-studio-outbox' },
      createdAt: relativeIso(-3),
    },
  ])
  .onConflictDoNothing();

await db
  .insert(productGrants)
  .values(
    grantSpecs.map((grant) => ({
      id: grant.id,
      tenantId: grant.tenantId,
      memberId: grant.memberId,
      productId: grant.productId,
      source: 'manual' as const,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      createdAt: nextIso(),
    })),
  )
  .onConflictDoNothing();

const oneTimePriceDefs: PriceDef[] = [
  { id: 'price-product-studio-kurs-101', tenantId: 'tenant-studio', productId: 'product-studio-kurs-101', kind: 'one_time', interval: null, amountCents: 19900 },
  { id: 'price-product-studio-warsztat', tenantId: 'tenant-studio', productId: 'product-studio-warsztat', kind: 'one_time', interval: null, amountCents: 49900 },
  { id: 'price-product-acme-course', tenantId: 'tenant-acme', productId: 'product-acme-course', kind: 'one_time', interval: null, amountCents: 9900 },
  ...demoProducts
    .filter((product) => product.id !== 'product-club')
    .map((product) => ({
      id: `price-${product.id}`,
      tenantId: product.tenantId,
      productId: product.id,
      kind: 'one_time' as const,
      interval: null,
      amountCents: product.priceCents,
    })),
];

await db
  .insert(productPrices)
  .values(
    [...oneTimePriceDefs, ...subscriptionPriceDefs].map((price) => ({
      id: price.id,
      tenantId: price.tenantId,
      productId: price.productId,
      kind: price.kind,
      interval: price.interval,
      amountCents: price.amountCents,
      currency: 'PLN',
      active: true,
      createdAt: nextIso(),
    })),
  )
  .onConflictDoNothing();

await db
  .insert(memberSubscriptions)
  .values([
    {
      id: 'subscription-studio-abonent',
      tenantId: 'tenant-studio',
      memberId: 'member-studio-abonent',
      productId: 'product-club',
      priceId: 'price-club-monthly',
      provider: 'simulated' as const,
      providerSubscriptionId: 'sim_sub_seed_abonent',
      status: 'active' as const,
      currentPeriodEnd: relativeIso(20),
      cancelAtPeriodEnd: false,
      createdAt: relativeIso(-40),
      updatedAt: relativeIso(-10),
    },
    {
      id: 'subscription-studio-aktywny-club',
      tenantId: 'tenant-studio',
      memberId: 'member-studio-aktywny',
      productId: 'product-club',
      priceId: 'price-club-monthly',
      provider: 'stripe' as const,
      providerSubscriptionId: 'sub_seed_aktywny_club',
      status: 'active' as const,
      currentPeriodEnd: relativeIso(10),
      cancelAtPeriodEnd: false,
      createdAt: relativeIso(-20),
      updatedAt: relativeIso(-2),
    },
  ])
  .onConflictDoNothing();

interface OrderDef {
  id: string;
  memberId: string;
  productId: string;
  priceId: string;
  kind: 'one_time' | 'recurring';
  status: 'paid' | 'failed';
  provider: 'stripe' | 'simulated';
  amountCents: number;
  providerObjectIds: Record<string, string>;
  createdAt: string;
}

const orderDefs: OrderDef[] = [
  {
    id: 'order-studio-aktywny-js',
    memberId: 'member-studio-aktywny',
    productId: 'product-js-full',
    priceId: 'price-product-js-full',
    kind: 'one_time',
    status: 'paid',
    provider: 'simulated',
    amountCents: 39900,
    providerObjectIds: { checkoutSession: 'sim_cs_seed_aktywny' },
    createdAt: relativeIso(-30),
  },
  {
    id: 'order-studio-aktywny-club',
    memberId: 'member-studio-aktywny',
    productId: 'product-club',
    priceId: 'price-club-monthly',
    kind: 'recurring',
    status: 'paid',
    provider: 'stripe',
    amountCents: 4900,
    providerObjectIds: { checkoutSession: 'cs_seed_aktywny_club', subscription: 'sub_seed_aktywny_club' },
    createdAt: relativeIso(-20),
  },
  {
    id: 'order-studio-modul-dom',
    memberId: 'member-studio-modul',
    productId: 'product-js-dom-module',
    priceId: 'price-product-js-dom-module',
    kind: 'one_time',
    status: 'paid',
    provider: 'simulated',
    amountCents: 9900,
    providerObjectIds: { checkoutSession: 'sim_cs_seed_modul' },
    createdAt: relativeIso(-14),
  },
  {
    id: 'order-studio-abonent-start',
    memberId: 'member-studio-abonent',
    productId: 'product-club',
    priceId: 'price-club-monthly',
    kind: 'recurring',
    status: 'paid',
    provider: 'simulated',
    amountCents: 4900,
    providerObjectIds: { checkoutSession: 'sim_cs_seed_abonent', subscription: 'sim_sub_seed_abonent' },
    createdAt: relativeIso(-40),
  },
  {
    id: 'order-studio-abonent-cycle-1',
    memberId: 'member-studio-abonent',
    productId: 'product-club',
    priceId: 'price-club-monthly',
    kind: 'recurring',
    status: 'paid',
    provider: 'simulated',
    amountCents: 4900,
    providerObjectIds: { invoice: 'sim_in_seed_abonent_1', subscription: 'sim_sub_seed_abonent' },
    createdAt: relativeIso(-10),
  },
  {
    id: 'order-studio-abonent-retry',
    memberId: 'member-studio-abonent',
    productId: 'product-club',
    priceId: 'price-club-monthly',
    kind: 'recurring',
    status: 'failed',
    provider: 'simulated',
    amountCents: 4900,
    providerObjectIds: { invoice: 'sim_in_seed_abonent_fail', subscription: 'sim_sub_seed_abonent' },
    createdAt: relativeIso(-11),
  },
];

await db
  .insert(coupons)
  .values({
    id: 'coupon-studio-partner20',
    tenantId: 'tenant-studio',
    code: 'PARTNER20',
    kind: 'percent',
    value: 20,
    scope: { kind: 'all' },
    appliesTo: 'both',
    recurringDuration: 'forever',
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    maxRedemptionsPerMember: null,
    status: 'active',
    partnerLabel: 'Akademia Partner',
    stripeCouponId: null,
    stripePromotionCodeId: null,
    createdAt: relativeIso(-60),
  })
  .onConflictDoNothing();

await db
  .insert(couponEvents)
  .values({
    id: 'coupon-event-studio-partner20-created',
    tenantId: 'tenant-studio',
    couponId: 'coupon-studio-partner20',
    type: 'created',
    occurredAt: relativeIso(-60),
  })
  .onConflictDoNothing();

await db
  .insert(orders)
  .values(
    orderDefs.map((order) => ({
      id: order.id,
      tenantId: 'tenant-studio',
      memberId: order.memberId,
      productId: order.productId,
      priceId: order.priceId,
      kind: order.kind,
      status: order.status,
      amountCents: order.amountCents,
      currency: 'PLN',
      provider: order.provider,
      providerObjectIds: order.providerObjectIds,
      createdAt: order.createdAt,
    })),
  )
  .onConflictDoNothing();

await db
  .update(orders)
  .set({
    couponId: 'coupon-studio-partner20',
    discountCents: 7980,
    amountCents: 31920,
  })
  .where(eq(orders.id, 'order-studio-aktywny-js'));

await db
  .insert(couponRedemptions)
  .values({
    id: 'coupon-redemption-studio-partner20',
    tenantId: 'tenant-studio',
    couponId: 'coupon-studio-partner20',
    orderId: 'order-studio-aktywny-js',
    memberId: 'member-studio-aktywny',
    email: 'kursant.aktywny@together.dev',
    discountCents: 7980,
    createdAt: relativeIso(-30),
  })
  .onConflictDoNothing();

await db
  .insert(couponRedemptionEvents)
  .values({
    id: 'coupon-redemption-event-studio-partner20',
    tenantId: 'tenant-studio',
    redemptionId: 'coupon-redemption-studio-partner20',
    couponId: 'coupon-studio-partner20',
    orderId: 'order-studio-aktywny-js',
    type: 'redeemed',
    occurredAt: relativeIso(-30),
  })
  .onConflictDoNothing();

await db
  .insert(couponCheckoutSessions)
  .values({
    id: 'coupon-session-studio-partner20',
    tenantId: 'tenant-studio',
    couponId: 'coupon-studio-partner20',
    providerSessionId: 'sim_cs_seed_aktywny',
    memberEmail: 'kursant.aktywny@together.dev',
    productId: 'product-js-full',
    priceId: 'price-product-js-full',
    originalCents: 39900,
    discountCents: 7980,
    finalCents: 31920,
    currency: 'PLN',
    startedAt: relativeIso(-30),
  })
  .onConflictDoNothing();

if (progressSpecs.length > 0) {
  await db
    .insert(memberCourseProgress)
    .values(
      progressSpecs.map((progress) => ({
        id: progress.id,
        tenantId: progress.tenantId,
        memberId: progress.memberId,
        courseId: progress.courseId,
        completedLessonIds: progress.completedLessonIds,
        lastViewedLessonId: progress.lastViewedLessonId,
        lastViewedModuleId: progress.lastViewedModuleId,
        lastViewedChapterId: progress.lastViewedChapterId,
        updatedAt: nextIso(),
      })),
    )
    // Converge on the canonical demo progress: browsing the demo member (for
    // example the visual harness) moves last-viewed, and a reseed must undo it.
    .onConflictDoUpdate({
      target: [
        memberCourseProgress.tenantId,
        memberCourseProgress.memberId,
        memberCourseProgress.courseId,
      ],
      set: {
        completedLessonIds: sql`excluded.completed_lesson_ids`,
        lastViewedLessonId: sql`excluded.last_viewed_lesson_id`,
        lastViewedModuleId: sql`excluded.last_viewed_module_id`,
        lastViewedChapterId: sql`excluded.last_viewed_chapter_id`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

await db
  .insert(memberEvents)
  .values([
    {
      id: 'member-event-studio-aktywny-email',
      tenantId: 'tenant-studio',
      memberId: 'member-studio-aktywny',
      type: 'email-sent',
      payload: {
        sendId: 'send-studio-marketing',
        mailKind: 'marketing',
        subject: 'Nowości w kursie JavaScript',
        source: 'broadcast',
        transport: 'tenant-ses',
      },
      occurredAt: relativeIso(-4),
    },
    {
      id: 'member-event-studio-aktywny-lesson',
      tenantId: 'tenant-studio',
      memberId: 'member-studio-aktywny',
      type: 'lesson-completion',
      payload: { courseId: 'course-js', lessonId: 'lesson-js-zmienne-2' },
      occurredAt: relativeIso(-5),
    },
    {
      id: 'member-event-studio-aktywny-subscription',
      tenantId: 'tenant-studio',
      memberId: 'member-studio-aktywny',
      type: 'subscription-change',
      payload: {
        subscriptionId: 'subscription-studio-aktywny-club',
        productId: 'product-club',
        status: 'active',
        currentPeriodEnd: relativeIso(10),
        cancelAtPeriodEnd: false,
        provider: 'stripe',
      },
      occurredAt: relativeIso(-2),
    },
    {
      id: 'member-event-studio-aktywny-club-purchase',
      tenantId: 'tenant-studio',
      memberId: 'member-studio-aktywny',
      type: 'purchase',
      payload: {
        orderId: 'order-studio-aktywny-club',
        productId: 'product-club',
        kind: 'recurring',
        status: 'paid',
        amountCents: 4900,
        currency: 'PLN',
        provider: 'stripe',
      },
      occurredAt: relativeIso(-20),
    },
    {
      id: 'member-event-studio-aktywny-club-grant',
      tenantId: 'tenant-studio',
      memberId: 'member-studio-aktywny',
      type: 'grant',
      payload: {
        grantId: 'grant-studio-aktywny-club',
        productId: 'product-club',
        source: 'stripe',
        startsAt: relativeIso(-20),
        expiresAt: relativeIso(40),
      },
      occurredAt: relativeIso(-20),
    },
  ])
  .onConflictDoNothing();

const studioCreatorUserId = creatorUserIds.get('tenant-studio') ?? '';
const memberUserId = (memberId: string): string => {
  const spec = memberSpecs.find((member) => member.id === memberId);
  if (!spec) throw new Error(`Seeded member not found: ${memberId}`);
  return spec.userId;
};

interface SeedPostDef {
  id: string;
  contextId: string;
  parentPostId: string | null;
  rootPostId: string;
  authorUserId: string;
  authorDisplay: string;
  authorIsStaff: boolean;
  body: string;
  createdAt: string;
  deletedAt: string | null;
}

const aktywnyUserId = memberUserId('member-studio-aktywny');
const freeUserId = memberUserId('member-studio-free');
const wygaslyUserId = memberUserId('member-studio-wygasly');
const modulUserId = memberUserId('member-studio-modul');

const discussionPosts: SeedPostDef[] = [
  {
    id: 'post-js-zmienne-tip',
    contextId: 'lesson-js-zmienne-1',
    parentPostId: null,
    rootPostId: 'post-js-zmienne-tip',
    authorUserId: wygaslyUserId,
    authorDisplay: 'Kursant Wygasły',
    authorIsStaff: false,
    body: 'Mała podpowiedź dla innych: przykłady z tej lekcji najwygodniej testować w konsoli przeglądarki (F12 → Console). Od razu widać, jak const blokuje ponowne przypisanie wartości.',
    createdAt: relativeIso(-20),
    deletedAt: null,
  },
  {
    id: 'post-js-zmienne-tip-r1',
    contextId: 'lesson-js-zmienne-1',
    parentPostId: 'post-js-zmienne-tip',
    rootPostId: 'post-js-zmienne-tip',
    authorUserId: freeUserId,
    authorDisplay: 'Konto Free',
    authorIsStaff: false,
    body: 'Dzięki, przydało się!',
    createdAt: relativeIso(-19),
    deletedAt: relativeIso(-18),
  },
  {
    id: 'post-js-zmienne-q',
    contextId: 'lesson-js-zmienne-1',
    parentPostId: null,
    rootPostId: 'post-js-zmienne-q',
    authorUserId: aktywnyUserId,
    authorDisplay: 'Kursant Aktywny',
    authorIsStaff: false,
    body: 'Czy jest jeszcze sens używać var? W starszych poradnikach na YouTube wszędzie widzę var, a w tej lekcji tylko let i const. Powinienem przepisywać stare przykłady, czy po prostu je pomijać?',
    createdAt: relativeIso(-3),
    deletedAt: null,
  },
  {
    id: 'post-js-zmienne-q-r1',
    contextId: 'lesson-js-zmienne-1',
    parentPostId: 'post-js-zmienne-q',
    rootPostId: 'post-js-zmienne-q',
    authorUserId: freeUserId,
    authorDisplay: 'Konto Free',
    authorIsStaff: false,
    body: 'Mam dokładnie to samo — zaczynałem od kursu sprzed kilku lat i wszystko było na var. Odkąd przepisuję przykłady na const i let, dużo łatwiej mi zauważyć, gdzie wartość naprawdę się zmienia.',
    createdAt: relativeIso(-2),
    deletedAt: null,
  },
  {
    id: 'post-js-zmienne-q-r2',
    contextId: 'lesson-js-zmienne-1',
    parentPostId: 'post-js-zmienne-q-r1',
    rootPostId: 'post-js-zmienne-q',
    authorUserId: studioCreatorUserId,
    authorDisplay: 'Studio Creator',
    authorIsStaff: true,
    body: 'Dobre pytanie! W nowym kodzie var zostawiamy historii: domyślnie używaj const, a let tylko tam, gdzie wartość faktycznie się zmienia. Przepisywanie starych przykładów to świetne ćwiczenie — szczerze polecam.',
    createdAt: relativeIso(-1),
    deletedAt: null,
  },
  {
    id: 'post-js-dom-q',
    contextId: 'lesson-js-dom-1',
    parentPostId: null,
    rootPostId: 'post-js-dom-q',
    authorUserId: modulUserId,
    authorDisplay: 'Kursant Modułowy',
    authorIsStaff: false,
    body: 'Utknąłem na querySelectorAll: zwraca NodeList, a nie tablicę, więc map w ogóle nie działał. Uratowało mnie Array.from(lista). Czy jest powód, dla którego przeglądarka nie zwraca zwykłej tablicy?',
    createdAt: relativeIso(-10),
    deletedAt: null,
  },
  {
    id: 'post-js-dom-q-r1',
    contextId: 'lesson-js-dom-1',
    parentPostId: 'post-js-dom-q',
    rootPostId: 'post-js-dom-q',
    authorUserId: studioCreatorUserId,
    authorDisplay: 'Studio Creator',
    authorIsStaff: true,
    body: 'Świetna obserwacja! NodeList to starszy interfejs DOM — powstał, zanim tablice miały dzisiejsze metody. Array.from albo spread [...lista] to dokładnie idiom, którego używamy w dalszej części tej lekcji.',
    createdAt: relativeIso(-9),
    deletedAt: null,
  },
];

await db
  .insert(posts)
  .values(
    discussionPosts.map((post) => ({
      id: post.id,
      tenantId: 'tenant-studio',
      contextKind: 'lesson' as const,
      contextId: post.contextId,
      parentPostId: post.parentPostId,
      rootPostId: post.rootPostId,
      authorUserId: post.authorUserId,
      authorDisplay: post.authorDisplay,
      authorIsStaff: post.authorIsStaff,
      body: post.body,
      createdAt: post.createdAt,
      editedAt: null,
      deletedAt: post.deletedAt,
    })),
  )
  .onConflictDoUpdate({
    target: posts.id,
    set: {
      body: sql`excluded.body`,
      createdAt: sql`excluded.created_at`,
      deletedAt: sql`excluded.deleted_at`,
      authorUserId: sql`excluded.author_user_id`,
      authorDisplay: sql`excluded.author_display`,
      authorIsStaff: sql`excluded.author_is_staff`,
    },
  });

const subscriptionDefs: Array<{ userId: string; rootPostId: string; createdAt: string }> = [
  { userId: wygaslyUserId, rootPostId: 'post-js-zmienne-tip', createdAt: relativeIso(-20) },
  { userId: freeUserId, rootPostId: 'post-js-zmienne-tip', createdAt: relativeIso(-19) },
  { userId: aktywnyUserId, rootPostId: 'post-js-zmienne-q', createdAt: relativeIso(-3) },
  { userId: freeUserId, rootPostId: 'post-js-zmienne-q', createdAt: relativeIso(-2) },
  { userId: studioCreatorUserId, rootPostId: 'post-js-zmienne-q', createdAt: relativeIso(-1) },
  { userId: modulUserId, rootPostId: 'post-js-dom-q', createdAt: relativeIso(-10) },
  { userId: studioCreatorUserId, rootPostId: 'post-js-dom-q', createdAt: relativeIso(-9) },
];

await db
  .insert(threadSubscriptions)
  .values(
    subscriptionDefs.map((subscription) => ({
      tenantId: 'tenant-studio',
      userId: subscription.userId,
      rootPostId: subscription.rootPostId,
      createdAt: subscription.createdAt,
      mutedAt: null,
    })),
  )
  .onConflictDoNothing();

const snippetOf = (body: string): string => body.replace(/\s+/g, ' ').slice(0, 180);
const postBody = (id: string): string => {
  const post = discussionPosts.find((item) => item.id === id);
  if (!post) throw new Error(`Seeded post not found: ${id}`);
  return post.body;
};

const notificationDefs = [
  {
    id: 'notif-aktywny-zmienne-r1',
    postId: 'post-js-zmienne-q-r1',
    authorDisplay: 'Konto Free',
    createdAt: relativeIso(-2),
    readAt: relativeIso(-1.5),
  },
  {
    id: 'notif-aktywny-zmienne-r2',
    postId: 'post-js-zmienne-q-r2',
    authorDisplay: 'Studio Creator',
    createdAt: relativeIso(-1),
    readAt: null,
  },
];

await db
  .insert(notifications)
  .values(
    notificationDefs.map((notification) => ({
      id: notification.id,
      tenantId: 'tenant-studio',
      recipientUserId: aktywnyUserId,
      kind: 'thread-reply' as const,
      payload: {
        rootPostId: 'post-js-zmienne-q',
        postId: notification.postId,
        contextKind: 'lesson',
        contextId: 'lesson-js-zmienne-1',
        courseId: 'course-js',
        lessonName: 'Deklarowanie zmiennych',
        authorDisplay: notification.authorDisplay,
        snippet: snippetOf(postBody(notification.postId)),
      },
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    })),
  )
  .onConflictDoUpdate({
    target: notifications.id,
    set: {
      payload: sql`excluded.payload`,
      readAt: sql`excluded.read_at`,
      createdAt: sql`excluded.created_at`,
    },
  });

interface SeedSpaceDef {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: 'members' | 'product';
  productIds: string[];
  publicReadOnly?: boolean;
  position: number;
}

const spaceDefs: SeedSpaceDef[] = [
  {
    id: 'space-studio-spolecznosc',
    slug: 'spolecznosc',
    name: 'Społeczność',
    description:
      'Otwarta przestrzeń dla wszystkich uczestników — przedstaw się i pogadaj z innymi.',
    visibility: 'members',
    productIds: [],
    publicReadOnly: true,
    position: 0,
  },
  {
    id: 'space-studio-klub-js',
    slug: 'klub-js',
    name: 'Klub JavaScriptu',
    description:
      'Przestrzeń dla posiadaczy pełnego kursu JavaScript — projekty, code review, wyzwania.',
    visibility: 'product',
    productIds: ['product-js-full'],
    position: 1,
  },
  {
    id: 'space-studio-klub-react',
    slug: 'klub-react',
    name: 'Klub Reacta',
    description:
      'Przestrzeń dla posiadaczy kursu React w praktyce — projekty, pytania i przegląd kodu.',
    visibility: 'product',
    productIds: ['product-react-full'],
    position: 2,
  },
];

await db
  .insert(spaces)
  .values(
    spaceDefs.map((space) => ({
      id: space.id,
      tenantId: 'tenant-studio',
      slug: space.slug,
      name: space.name,
      description: space.description,
      visibility: space.visibility,
      productIds: space.productIds,
      publicReadOnly: space.publicReadOnly ?? false,
      position: space.position,
      createdAt: relativeIso(-30),
    })),
  )
  .onConflictDoUpdate({
    target: spaces.id,
    set: {
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      visibility: sql`excluded.visibility`,
      productIds: sql`excluded.product_ids`,
      publicReadOnly: sql`excluded.public_read_only`,
      position: sql`excluded.position`,
    },
  });

const spacePosts: SeedPostDef[] = [
  {
    id: 'post-spolecznosc-hello',
    contextId: 'space-studio-spolecznosc',
    parentPostId: null,
    rootPostId: 'post-spolecznosc-hello',
    authorUserId: studioCreatorUserId,
    authorDisplay: 'Studio Creator',
    authorIsStaff: true,
    body: 'Witajcie w Społeczności! To otwarta przestrzeń dla wszystkich uczestników — przedstawcie się w komentarzach i napiszcie, czego się teraz uczycie.',
    createdAt: relativeIso(-14),
    deletedAt: null,
  },
  {
    id: 'post-spolecznosc-hello-r1',
    contextId: 'space-studio-spolecznosc',
    parentPostId: 'post-spolecznosc-hello',
    rootPostId: 'post-spolecznosc-hello',
    authorUserId: aktywnyUserId,
    authorDisplay: 'Kursant Aktywny',
    authorIsStaff: false,
    body: 'Cześć! Przerabiam właśnie moduł o DOM i powoli składam pierwszy własny projekt — licznik nawyków.',
    createdAt: relativeIso(-13),
    deletedAt: null,
  },
  {
    id: 'post-spolecznosc-polecajki',
    contextId: 'space-studio-spolecznosc',
    parentPostId: null,
    rootPostId: 'post-spolecznosc-polecajki',
    authorUserId: freeUserId,
    authorDisplay: 'Konto Free',
    authorIsStaff: false,
    body: 'Mała polecajka: strona javascript.info świetnie uzupełnia lekcje z kursu. Macie swoje ulubione materiały dodatkowe?',
    createdAt: relativeIso(-6),
    deletedAt: null,
  },
  {
    id: 'post-klub-wyzwanie',
    contextId: 'space-studio-klub-js',
    parentPostId: null,
    rootPostId: 'post-klub-wyzwanie',
    authorUserId: studioCreatorUserId,
    authorDisplay: 'Studio Creator',
    authorIsStaff: true,
    body: 'Wyzwanie tygodnia: napiszcie funkcję, która spłaszcza dowolnie zagnieżdżoną tablicę bez użycia Array.prototype.flat. Rozwiązania wrzucajcie w odpowiedziach!',
    createdAt: relativeIso(-4),
    deletedAt: null,
  },
  {
    id: 'post-klub-wyzwanie-r1',
    contextId: 'space-studio-klub-js',
    parentPostId: 'post-klub-wyzwanie',
    rootPostId: 'post-klub-wyzwanie',
    authorUserId: aktywnyUserId,
    authorDisplay: 'Kursant Aktywny',
    authorIsStaff: false,
    body: 'Moja wersja z rekurencją i reduce: reduce((acc, el) => acc.concat(Array.isArray(el) ? splaszcz(el) : el), []). Działa też dla pustych tablic.',
    createdAt: relativeIso(-3),
    deletedAt: null,
  },
];

await db
  .insert(posts)
  .values(
    spacePosts.map((post) => ({
      id: post.id,
      tenantId: 'tenant-studio',
      contextKind: 'space' as const,
      contextId: post.contextId,
      parentPostId: post.parentPostId,
      rootPostId: post.rootPostId,
      authorUserId: post.authorUserId,
      authorDisplay: post.authorDisplay,
      authorIsStaff: post.authorIsStaff,
      body: post.body,
      createdAt: post.createdAt,
      editedAt: null,
      deletedAt: post.deletedAt,
    })),
  )
  .onConflictDoUpdate({
    target: posts.id,
    set: {
      body: sql`excluded.body`,
      createdAt: sql`excluded.created_at`,
      deletedAt: sql`excluded.deleted_at`,
      authorUserId: sql`excluded.author_user_id`,
      authorDisplay: sql`excluded.author_display`,
      authorIsStaff: sql`excluded.author_is_staff`,
    },
  });

await db
  .insert(postReports)
  .values({
    id: 'report-studio-polecajki',
    tenantId: 'tenant-studio',
    postId: 'post-spolecznosc-polecajki',
    reporterUserId: aktywnyUserId,
    reporterDisplay: 'Kursant Aktywny',
    source: 'member',
    reason: 'off-topic',
    note: 'Ten wpis wygląda jak reklama zewnętrznego serwisu.',
    signals: null,
    status: 'open',
    createdAt: relativeIso(-5),
    resolvedAt: null,
    resolvedByUserId: null,
  })
  .onConflictDoNothing();

await db
  .insert(postReportEvents)
  .values({
    id: 'report-event-studio-polecajki-opened',
    tenantId: 'tenant-studio',
    reportId: 'report-studio-polecajki',
    postId: 'post-spolecznosc-polecajki',
    type: 'opened',
    occurredAt: relativeIso(-5),
  })
  .onConflictDoNothing();

const reactionDefs: Array<{ postId: string; userId: string; emoji: string; createdAt: string }> = [
  { postId: 'post-spolecznosc-hello', userId: aktywnyUserId, emoji: '👍', createdAt: relativeIso(-13) },
  { postId: 'post-spolecznosc-hello', userId: freeUserId, emoji: '👍', createdAt: relativeIso(-12) },
  { postId: 'post-spolecznosc-hello', userId: modulUserId, emoji: '🎉', createdAt: relativeIso(-12) },
  { postId: 'post-spolecznosc-polecajki', userId: aktywnyUserId, emoji: '💡', createdAt: relativeIso(-5) },
  { postId: 'post-spolecznosc-polecajki', userId: studioCreatorUserId, emoji: '❤️', createdAt: relativeIso(-5) },
  { postId: 'post-klub-wyzwanie', userId: aktywnyUserId, emoji: '🎉', createdAt: relativeIso(-4) },
  { postId: 'post-klub-wyzwanie-r1', userId: studioCreatorUserId, emoji: '👍', createdAt: relativeIso(-3) },
];

await db
  .insert(postReactions)
  .values(
    reactionDefs.map((reaction) => ({
      tenantId: 'tenant-studio',
      postId: reaction.postId,
      userId: reaction.userId,
      emoji: reaction.emoji,
      createdAt: reaction.createdAt,
    })),
  )
  .onConflictDoNothing();

const spaceSubscriptionDefs: Array<{ userId: string; spaceId: string; createdAt: string }> = [
  { userId: aktywnyUserId, spaceId: 'space-studio-spolecznosc', createdAt: relativeIso(-14) },
  { userId: freeUserId, spaceId: 'space-studio-spolecznosc', createdAt: relativeIso(-10) },
  { userId: studioCreatorUserId, spaceId: 'space-studio-spolecznosc', createdAt: relativeIso(-14) },
  { userId: aktywnyUserId, spaceId: 'space-studio-klub-js', createdAt: relativeIso(-4) },
  { userId: studioCreatorUserId, spaceId: 'space-studio-klub-js', createdAt: relativeIso(-4) },
];

await db
  .insert(spaceSubscriptions)
  .values(
    spaceSubscriptionDefs.map((subscription) => ({
      tenantId: 'tenant-studio',
      userId: subscription.userId,
      spaceId: subscription.spaceId,
      createdAt: subscription.createdAt,
    })),
  )
  .onConflictDoNothing();

await db
  .insert(threadSubscriptions)
  .values(
    [
      { userId: studioCreatorUserId, rootPostId: 'post-spolecznosc-hello', createdAt: relativeIso(-14) },
      { userId: aktywnyUserId, rootPostId: 'post-spolecznosc-hello', createdAt: relativeIso(-13) },
      { userId: freeUserId, rootPostId: 'post-spolecznosc-polecajki', createdAt: relativeIso(-6) },
      { userId: studioCreatorUserId, rootPostId: 'post-klub-wyzwanie', createdAt: relativeIso(-4) },
      { userId: aktywnyUserId, rootPostId: 'post-klub-wyzwanie', createdAt: relativeIso(-3) },
    ].map((subscription) => ({
      tenantId: 'tenant-studio',
      userId: subscription.userId,
      rootPostId: subscription.rootPostId,
      createdAt: subscription.createdAt,
      mutedAt: null,
    })),
  )
  .onConflictDoNothing();

console.log('Seed applied:');
for (const creator of creators) {
  console.log(`  creator  ${creator.email} / ${PASSWORD}  ->  ${creator.tenant.slug}`);
}
for (const member of memberSpecs) {
  console.log(`  member   ${member.email}  ->  ${member.tenantId}`);
}
console.log('  community  discussions under course-js lessons; unread notification for kursant.aktywny@together.dev');
console.log('  spaces   Społeczność (members) + Klub JavaScriptu (product-js-full) + Klub Reacta (product-react-full, locked for kursant.aktywny) on studio, with posts/reactions/follows');
console.log('  public   course-js is publicly visible; Społeczność is publicly readable and is the studio home space');
console.log('  sales    product-club subscription (monthly+yearly), active simulated subscription for kursant.abonent@together.dev, demo orders on studio');
console.log('  tenants  http://studio.localhost:48730  http://acme.localhost:48730  http://akademia.localhost:48730');
process.exit(0);
