import { and, eq, sql } from 'drizzle-orm';

import {
  DEMO_SEED_PASSWORD,
  type AccessItem,
  type Chapter,
  type LessonBlock,
  type ProductType,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import { SAMPLE_LESSON_PDF_URL } from './sample-assets.js';
import { createSeedUsers } from './seed-users.js';
import { applySmokeTenantSeed } from './smoke-tenant-seed.js';
import {
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
  tenantRedirects,
  tenantDocuments,
  tenantDocumentVersions,
  tenants,
  threadSubscriptions,
  unsubscribeTokens,
} from './schema.js';

export interface SeedSummary {
  password: string;
  creators: Array<{ email: string; tenantSlug: string }>;
  members: Array<{ email: string; tenantId: string }>;
}

export const printSeedSummary = (summary: SeedSummary): void => {
  console.log('Seed applied (creator password: the shared demo password from app/CLAUDE.md):');
  for (const creator of summary.creators) {
    console.log(`  creator  ${creator.email}  ->  ${creator.tenantSlug}`);
  }
  for (const member of summary.members) {
    console.log(`  member   ${member.email}  ->  ${member.tenantId}`);
  }
  console.log('  community  discussions under course-js lessons; unread notification for student.active@together.dev');
  console.log('  spaces   Community (members) + JavaScript Club (product-js-full) + React Club (product-react-full) on studio, with posts/reactions/follows');
  console.log('  public   course-js is publicly visible; Community is publicly readable and is the studio home space');
  console.log('  sales    product-club subscription (monthly+yearly), active simulated subscription for student.subscriber@together.dev, demo orders on studio');
  console.log('  tenants  http://studio.localhost:48730  http://acme.localhost:48730  http://akademia.localhost:48730');
};

export const applySeed = async (db: Db): Promise<SeedSummary> => {
  const PASSWORD = DEMO_SEED_PASSWORD;

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

  const users = createSeedUsers(db, seedClock);

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
      email: 'creator3@together.dev',
      name: 'Akademia Creator',
      tenant: { id: 'tenant-akademia', slug: 'akademia', name: 'Akademia Samouka' },
    },
  ];

  const ensureCreator = (email: string, name: string): Promise<string> =>
    users.ensurePassworded(email, name, PASSWORD);

  const ensurePasswordlessUser = (id: string, email: string, name: string): Promise<string> =>
    users.ensurePasswordless(id, email, name);

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
      name: 'Video demo (Bunny Stream)',
      contents: [
        video(BUNNY_DEMO_LIBRARY_ID, BUNNY_DEMO_VIDEO_ID),
        html(
          '<h3>Bunny Stream video player</h3><p>This lesson shows a real Bunny Stream video embedded in the platform player. Together delivers video through Bunny Stream, a global video host with adaptive streaming quality (HLS).</p><p>To add your own recording, upload it to your Bunny Stream library and paste the library and video IDs into the lesson editor.</p>',
        ),
      ],
    },
    {
      id: 'lesson-js-variables-1',
      durationMinutes: 12,
      name: 'Declaring variables',
      contents: [
        embed('W6NZfCO5SIk'),
        html(
          '<h3>Variables in JavaScript</h3><p>JavaScript declares variables with <code>let</code>, <code>const</code>, and the older <code>var</code> keyword. Modern code mostly uses the first two.</p><ul><li><strong>const</strong> - a binding you do not intend to reassign.</li><li><strong>let</strong> - a variable whose value will change over time.</li></ul><p>Use <code>const</code> by default and switch to <code>let</code> when you need to assign a new value.</p>',
        ),
        link(
          'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types',
          'MDN - JavaScript grammar and types',
        ),
      ],
    },
    {
      id: 'lesson-js-variables-2',
      durationMinutes: 15,
      name: 'Primitive and complex types',
      contents: [
        html(
          '<h3>Data types</h3><p>JavaScript distinguishes primitive types (<code>string</code>, <code>number</code>, <code>boolean</code>, <code>null</code>, <code>undefined</code>, <code>symbol</code>, and <code>bigint</code>) from objects, including arrays.</p><p>Primitive values are copied directly. With objects, the copied value is a reference to the same object, so changing that object is visible through either reference.</p>',
        ),
        embed('hdI2bqOjy3c'),
      ],
    },
    {
      id: 'lesson-js-functions-1',
      durationMinutes: 18,
      name: 'Functions and arguments',
      contents: [
        embed('N8ap4k_1QEQ'),
        html(
          '<h3>Functions</h3><p>A function is a piece of code you can call repeatedly. JavaScript functions are <strong>first-class values</strong>: you can assign them to variables and pass them as arguments.</p><ul><li>Function declaration: <code>function sum(a, b) { return a + b; }</code></li><li>Arrow function: <code>const sum = (a, b) =&gt; a + b;</code></li></ul>',
        ),
      ],
    },
    {
      id: 'lesson-js-functions-2',
      durationMinutes: 22,
      name: 'Closures and scope',
      contents: [
        html(
          '<h3>Closures</h3><p>A closure lets a function retain access to variables from the scope where it was created. This is one of the core mechanisms of the language.</p><p>Closures are useful for counters, helper functions, and functional programming.</p>',
        ),
        link('https://github.com/getify/You-Dont-Know-JS', 'You Don’t Know JS - a free JavaScript book series'),
      ],
    },
    {
      id: 'lesson-js-dom-1',
      durationMinutes: 14,
      name: 'Selecting DOM elements',
      contents: [
        embed('0ik6X4DJKCc'),
        html(
          '<h3>The DOM tree</h3><p>The DOM (Document Object Model) represents a page as a tree of nodes. Select elements with <code>querySelector</code> and <code>querySelectorAll</code>.</p><ul><li><code>document.querySelector(&quot;.example&quot;)</code> - the first matching element.</li><li><code>document.querySelectorAll(&quot;li&quot;)</code> - a list of all matching elements.</li></ul>',
        ),
        pdf(SAMPLE_PDF, 'DOM methods cheat sheet (PDF)'),
      ],
    },
    {
      id: 'lesson-js-dom-2',
      durationMinutes: 19,
      name: 'Events and interaction',
      contents: [
        html(
          '<h3>Handling events</h3><p>Make a page interactive by listening for events with <code>addEventListener</code>. Common events include <code>click</code>, <code>input</code>, and <code>submit</code>.</p><p>When handling a form, call <code>event.preventDefault()</code> if you need to take control of the default browser behavior.</p>',
        ),
        embed('jS4aFq5-91M'),
        link('https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener', 'MDN — addEventListener'),
      ],
    },
    {
      id: 'lesson-js-project-1',
      durationMinutes: 35,
      name: 'Project: a to-do list',
      contents: [
        embed('8dWL3wF_OMw'),
        html(
          '<h3>Final project</h3><p>Put your new skills together by building a simple to-do app. You will use DOM manipulation, event handling, and <code>localStorage</code> to save state.</p><ul><li>Add and remove tasks.</li><li>Mark tasks as complete.</li><li>Keep your data after refreshing the page.</li></ul>',
        ),
        link('https://github.com/acme-courses/todo-vanilla', 'Project starter repository on GitHub'),
      ],
    },
    {
      id: 'lesson-react-jsx-1',
      durationMinutes: 11,
      name: 'What is JSX?',
      contents: [
        embed('SqcY0GlETPk'),
        html(
          '<h3>JSX syntax</h3><p>JSX lets you describe an interface with HTML-like syntax directly in JavaScript. A JSX compiler turns this markup into JavaScript calls that create React elements. The classic transform uses <code>React.createElement</code>.</p><p>Each component returns one element tree. To group sibling elements without an extra wrapper, use a fragment: <code>&lt;&gt;...&lt;/&gt;</code>.</p>',
        ),
        link('https://react.dev/learn/writing-markup-with-jsx', 'React documentation - writing markup with JSX'),
      ],
    },
    {
      id: 'lesson-react-jsx-2',
      durationMinutes: 16,
      name: 'Components and props',
      contents: [
        html(
          '<h3>Components</h3><p>A component is a function that returns JSX. Pass data into components through <strong>props</strong>, which are read-only inputs.</p><ul><li>Start component names with a capital letter.</li><li>Props are immutable: a component should never modify them.</li></ul>',
        ),
        embed('Rh3tobg7hEo'),
      ],
    },
    {
      id: 'lesson-react-state-1',
      durationMinutes: 14,
      name: 'Component state with useState',
      contents: [
        embed('O6P86uwfdR0'),
        html(
          '<h3>The useState hook</h3><p>State is data that changes during the lifetime of a component. The <code>useState</code> hook returns a pair: the current value and a setter function.</p><p>Updating state triggers another render of the component with the new data.</p>',
        ),
        link('https://react.dev/reference/react/useState', 'React documentation - useState'),
      ],
    },
    {
      id: 'lesson-react-state-2',
      durationMinutes: 17,
      name: 'Data flow and lifting state up',
      contents: [
        html(
          '<h3>Lifting state up</h3><p>When several components need the same data, move that state into their closest shared parent and pass it down through props. This is a basic pattern for data flow in React.</p>',
        ),
        embed('bMknfKXIFA8'),
      ],
    },
    {
      id: 'lesson-react-hooks-1',
      durationMinutes: 21,
      name: 'Side effects with useEffect',
      contents: [
        embed('0ZJgIjIuY7U'),
        html(
          '<h3>The useEffect hook</h3><p>Use <code>useEffect</code> to synchronize with external systems, such as network requests, subscriptions, or manual DOM updates. The dependency array controls when the effect runs again.</p><ul><li>An empty array <code>[]</code> runs the effect after mounting; development Strict Mode also checks setup and cleanup with an extra cycle.</li><li>Return a cleanup function to release resources before the effect runs again or the component unmounts.</li></ul>',
        ),
        link('https://react.dev/reference/react/useEffect', 'React documentation - useEffect'),
      ],
    },
    {
      id: 'lesson-react-hooks-2',
      durationMinutes: 25,
      name: 'Creating custom hooks',
      contents: [
        html(
          '<h3>Custom hooks</h3><p>Extract reusable stateful logic into custom hooks: functions whose names start with <code>use</code>. This lets components share logic without duplicating code.</p>',
        ),
        embed('6ThXsUwLWvc'),
        link('https://github.com/streamich/react-use', 'react-use - a library of ready-made hooks (GitHub)'),
      ],
    },
  ];

  const akademiaLessons: LessonDef[] = [
    {
      id: 'lesson-akademia-1-1',
      durationMinutes: 9,
      name: 'How to learn programming',
      contents: [
        embed('zOjov-2OZ0E'),
        html(
          '<h3>Learning from scratch</h3><p>Learning to code on your own is a marathon, not a sprint. Build a regular habit and work on small projects you can finish.</p><ul><li>Study every day, even if you only have half an hour.</li><li>Write code yourself; reading alone is not enough.</li><li>Treat mistakes as opportunities to learn.</li></ul>',
        ),
        link('https://roadmap.sh', 'roadmap.sh - learning paths for developers'),
      ],
    },
    {
      id: 'lesson-akademia-1-2',
      durationMinutes: 13,
      name: 'Tools and development environment',
      contents: [
        html(
          '<h3>Your development environment</h3><p>Before you start coding, set up a comfortable workspace: an editor such as VS Code, a terminal, and the <code>git</code> version control system.</p><p>Good tools help you work and learn more efficiently, but you still need to practice using them.</p>',
        ),
        embed('pQN-pnXPaVg'),
      ],
    },
    {
      id: 'lesson-akademia-2-1',
      durationMinutes: 24,
      name: 'Hands-on exercises',
      contents: [
        embed('rfscVS0vtbw'),
        html(
          '<h3>Practice builds confidence</h3><p>Solving algorithm exercises and building your own projects help you retain what you learn. Start with simple exercises and gradually increase the difficulty.</p>',
        ),
        pdf(SAMPLE_PDF, 'Practice exercises (PDF)'),
      ],
    },
    {
      id: 'lesson-akademia-2-2',
      durationMinutes: 10,
      name: 'Building a portfolio',
      contents: [
        html(
          '<h3>Portfolio</h3><p>Publish completed projects on GitHub and showcase them in your portfolio. Working projects give employers concrete examples of your skills and how you solve problems.</p>',
        ),
        link('https://github.com', 'GitHub - a home for your projects'),
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
      id: 'module-js-basics',
      courseId: 'course-js',
      prefix: 'Part 1',
      title: 'Basics',
      chapters: [
        {
          id: 'chapter-js-demo',
          name: 'Introduction',
          contents: [content('lesson-js-demo-video', 'Video demo (Bunny Stream)')],
        },
        {
          id: 'chapter-js-variables',
          name: 'Variables and types',
          contents: [
            content('lesson-js-variables-1', 'Declaring variables'),
            content('lesson-js-variables-2', 'Primitive and complex types'),
          ],
        },
        {
          id: 'chapter-js-functions',
          name: 'Functions',
          contents: [
            content('lesson-js-functions-1', 'Functions and arguments'),
            content('lesson-js-functions-2', 'Closures and scope'),
          ],
        },
      ],
    },
    {
      id: 'module-js-dom',
      courseId: 'course-js',
      prefix: 'Part 2',
      title: 'DOM',
      chapters: [
        {
          id: 'chapter-js-dom',
          name: 'DOM manipulation',
          contents: [
            content('lesson-js-dom-1', 'Selecting DOM elements'),
            content('lesson-js-dom-2', 'Events and interaction'),
          ],
        },
      ],
    },
    {
      id: 'module-js-projects',
      courseId: 'course-js',
      prefix: 'Part 3',
      title: 'Projects',
      chapters: [
        {
          id: 'chapter-js-projects',
          name: 'Final project',
          contents: [content('lesson-js-project-1', 'Project: a to-do list')],
        },
      ],
    },
    {
      id: 'module-react-fundamentals',
      courseId: 'course-react',
      prefix: 'Part 1',
      title: 'Fundamentals',
      chapters: [
        {
          id: 'chapter-react-jsx',
          name: 'JSX and components',
          contents: [
            content('lesson-react-jsx-1', 'What is JSX?'),
            content('lesson-react-jsx-2', 'Components and props'),
          ],
        },
        {
          id: 'chapter-react-state',
          name: 'State and props',
          contents: [
            content('lesson-react-state-1', 'Component state with useState'),
            content('lesson-react-state-2', 'Data flow and lifting state up'),
          ],
        },
      ],
    },
    {
      id: 'module-react-advanced',
      courseId: 'course-react',
      prefix: 'Part 2',
      title: 'Advanced patterns',
      chapters: [
        {
          id: 'chapter-react-hooks',
          name: 'Custom hooks',
          contents: [
            content('lesson-react-hooks-1', 'Side effects with useEffect'),
            content('lesson-react-hooks-2', 'Creating custom hooks'),
          ],
        },
      ],
    },
  ];

  const akademiaModules: ModuleDef[] = [
    {
      id: 'module-akademia-1',
      courseId: 'course-akademia',
      prefix: 'Part 1',
      title: 'Learning from scratch',
      chapters: [
        {
          id: 'chapter-akademia-1',
          name: 'Getting started',
          contents: [
            content('lesson-akademia-1-1', 'How to learn programming'),
            content('lesson-akademia-1-2', 'Tools and development environment'),
          ],
        },
      ],
    },
    {
      id: 'module-akademia-2',
      courseId: 'course-akademia',
      prefix: 'Part 2',
      title: 'Practice',
      chapters: [
        {
          id: 'chapter-akademia-2',
          name: 'Exercises',
          contents: [
            content('lesson-akademia-2-1', 'Hands-on exercises'),
            content('lesson-akademia-2-2', 'Building a portfolio'),
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
      name: 'JavaScript from Scratch',
      description: 'A complete JavaScript course, from variables, functions, and the DOM to your first project.',
      imageUrl: 'https://picsum.photos/seed/together-course-js/960/540',
      publiclyVisible: true,
    },
    {
      id: 'course-react',
      tenantId: 'tenant-studio',
      name: 'React in Practice',
      description: 'Build interfaces in React with components, state, hooks, and advanced patterns.',
      imageUrl: 'https://picsum.photos/seed/together-course-react/960/540',
    },
    {
      id: 'course-akademia',
      tenantId: 'tenant-akademia',
      name: 'Learning to Code on Your Own',
      description: 'A guide to learning programming independently: methods, tools, and practice.',
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
      title: 'JavaScript Course - full access',
      description: 'Full access to every module in JavaScript from Scratch.',
      priceCents: 39900,
      accessItems: [{ level: 'course', courseId: 'course-js' }],
    },
    {
      id: 'product-react-full',
      tenantId: 'tenant-studio',
      type: 'course',
      title: 'React in Practice - full access',
      description: 'Full access to React in Practice.',
      priceCents: 49900,
      accessItems: [{ level: 'course', courseId: 'course-react' }],
    },
    {
      id: 'product-js-dom-module',
      tenantId: 'tenant-studio',
      type: 'course',
      title: 'DOM Module Pack',
      description: 'Access to the DOM module of the JavaScript course.',
      priceCents: 9900,
      accessItems: [{ level: 'modules', courseId: 'course-js', moduleIds: ['module-js-dom'] }],
    },
    {
      id: 'product-free-preview',
      tenantId: 'tenant-studio',
      type: 'course',
      title: 'Free preview',
      description: 'Free sample lessons from every module in both courses, plus the video demo.',
      priceCents: 0,
      accessItems: [
        {
          level: 'lessons',
          courseId: 'course-js',
          lessonIds: ['lesson-js-demo-video', 'lesson-js-variables-1', 'lesson-js-dom-1', 'lesson-js-project-1'],
        },
        {
          level: 'lessons',
          courseId: 'course-react',
          lessonIds: ['lesson-react-jsx-1', 'lesson-react-hooks-1'],
        },
      ],
    },
    {
      id: 'product-akademia-annual',
      tenantId: 'tenant-akademia',
      type: 'course',
      title: 'Akademia - annual access',
      description: 'One year of access to Learning to Code on Your Own.',
      priceCents: 29900,
      accessItems: [{ level: 'course', courseId: 'course-akademia' }],
    },
    {
      id: 'product-club',
      tenantId: 'tenant-studio',
      type: 'membership',
      title: 'Studio Club - subscription',
      description: 'Club membership includes access to the JavaScript and React courses while your subscription is active.',
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
      title: 'Creator Workbook',
      description: 'Exercises and checklists for independent practice after purchase.',
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
      id: 'member-studio-active',
      userId: 'user-student-active',
      tenantId: 'tenant-studio',
      email: 'student.active@together.dev',
      displayName: 'Active Student',
      grant: {
        id: 'grant-studio-active',
        productId: 'product-js-full',
        startsAt: relativeIso(-30),
        expiresAt: null,
      },
      progress: {
        courseId: 'course-js',
        completedLessonIds: ['lesson-js-variables-1', 'lesson-js-variables-2'],
        lastViewedLessonId: 'lesson-js-functions-1',
        lastViewedModuleId: 'module-js-basics',
        lastViewedChapterId: 'chapter-js-functions',
      },
    },
    {
      id: 'member-studio-expired',
      userId: 'user-student-expired',
      tenantId: 'tenant-studio',
      email: 'student.expired@together.dev',
      displayName: 'Expired Student',
      grant: {
        id: 'grant-studio-expired',
        productId: 'product-js-full',
        startsAt: relativeIso(-30),
        expiresAt: relativeIso(-7),
      },
    },
    {
      id: 'member-studio-future',
      userId: 'user-student-future',
      tenantId: 'tenant-studio',
      email: 'student.future@together.dev',
      displayName: 'Future Student',
      grant: {
        id: 'grant-studio-future',
        productId: 'product-js-full',
        startsAt: relativeIso(7),
        expiresAt: relativeIso(372),
      },
    },
    {
      id: 'member-studio-module',
      userId: 'user-student-module',
      tenantId: 'tenant-studio',
      email: 'student.module@together.dev',
      displayName: 'Module Student',
      grant: {
        id: 'grant-studio-module',
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
      displayName: 'Free Account',
      grant: {
        id: 'grant-studio-free',
        productId: 'product-free-preview',
        startsAt: relativeIso(-3),
        expiresAt: null,
      },
    },
    {
      id: 'member-studio-subscriber',
      userId: 'user-student-subscriber',
      tenantId: 'tenant-studio',
      email: 'student.subscriber@together.dev',
      displayName: 'Subscriber Student',
      grant: {
        id: 'grant-studio-subscriber',
        productId: 'product-club',
        startsAt: relativeIso(-40),
        expiresAt: relativeIso(23),
      },
    },
    {
      id: 'member-akademia-student',
      userId: 'user-student-akademia',
      tenantId: 'tenant-akademia',
      email: 'student.akademia@together.dev',
      displayName: 'Akademia Student',
      grant: {
        id: 'grant-akademia-student',
        productId: 'product-akademia-annual',
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
    .values(creators.map((creator) => ({ ...creator.tenant, defaultLanguage: 'en' as const, createdAt: nextIso() })))
    .onConflictDoUpdate({ target: tenants.id, set: { defaultLanguage: 'en' } });

  await db
    .update(tenants)
    .set({ billingPortalUrl: STUDIO_BILLING_PORTAL_URL, defaultHomeSpaceId: 'space-studio-community' })
    .where(eq(tenants.id, 'tenant-studio'));


  await db
    .update(tenants)
    .set({
      logoUrl: '/assets/akademia-wordmark.svg',
      accentColor: '#0E7490',
      faviconUrl: '/assets/akademia-logo.svg',
    })
    .where(eq(tenants.id, 'tenant-akademia'));

  await db
    .insert(tenantDocuments)
    .values({
      id: 'document-akademia-privacy', tenantId: 'tenant-akademia', slug: 'privacy-policy',
      title: 'Privacy policy', status: 'published', createdAt: relativeIso(-90), updatedAt: relativeIso(-30),
    })
    .onConflictDoNothing();

  await db
    .insert(tenantDocumentVersions)
    .values({
      id: 'document-akademia-privacy-v1', tenantId: 'tenant-akademia', documentId: 'document-akademia-privacy', version: 1,
      content: '# How we handle your data\n\nWe respect your privacy and use your data only to provide the services you choose.\n\n## Contact\n\nFor questions about your data, email [privacy@akademia.test](mailto:privacy@akademia.test).\n\n- You can withdraw consent at any time.\n- Every change is recorded in your consent history.',
      publishedAt: relativeIso(-30), createdAt: relativeIso(-30), createdBy: null,
    })
    .onConflictDoNothing();

  await db
    .insert(consentDefinitions)
    .values({
      id: 'consent-definition-akademia-news', tenantId: 'tenant-akademia', key: 'news',
      kind: 'optional_marketing', channel: 'email', doubleOptIn: true,
      documentRef: { mode: 'hosted', documentId: 'document-akademia-privacy' }, status: 'active',
      createdAt: relativeIso(-25), updatedAt: relativeIso(-25),
    })
    .onConflictDoNothing();

  await db
    .insert(consentDefinitionVersions)
    .values({
      id: 'consent-definition-akademia-news-v1', tenantId: 'tenant-akademia', definitionId: 'consent-definition-akademia-news', version: 1,
      label: 'I would like to receive news and practical resources by email',
      documentVersionRef: { mode: 'hosted', documentVersionId: 'document-akademia-privacy-v1' },
      createdAt: relativeIso(-25), createdBy: null,
    })
    .onConflictDoNothing();

  await db
    .insert(consentDefinitions)
    .values({
      id: 'consent-definition-studio-news', tenantId: 'tenant-studio', key: 'news',
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
      label: 'I would like to receive news by email',
      documentVersionRef: { mode: 'url', url: 'https://studio.example.test/privacy' },
      createdAt: relativeIso(-25), createdBy: null,
    })
    .onConflictDoNothing();

  await db
    .insert(marketingConsents)
    .values([
      {
        id: 'marketing-consent-akademia-granted', tenantId: 'tenant-akademia', memberId: null,
        email: 'student.akademia@together.dev', definitionId: 'consent-definition-akademia-news', definitionVersion: 1,
        wordingSnapshot: 'I would like to receive news and practical resources by email',
        documentRefSnapshot: { mode: 'hosted', documentVersionId: 'document-akademia-privacy-v1' },
        status: 'granted', previousId: null, source: 'checkout',
        evidence: { collectedAt: relativeIso(-20), proofRef: 'seeded-checkout' }, occurredAt: relativeIso(-20),
      },
      {
        id: 'marketing-consent-akademia-confirmed', tenantId: 'tenant-akademia', memberId: null,
        email: 'student.akademia@together.dev', definitionId: 'consent-definition-akademia-news', definitionVersion: 1,
        wordingSnapshot: 'I would like to receive news and practical resources by email',
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
      token: 'unsubscribe_akademia_visual_123456', email: 'student.akademia@together.dev',
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
    .insert(tenantRedirects)
    .values([
      {
        id: 'redirect-studio-course-js',
        tenantId: 'tenant-studio',
        fromPath: '/course/javascript',
        targetKind: 'course' as const,
        targetId: 'course-js',
        targetPath: '/my/courses/course-js',
        permanent: true,
        origin: 'import' as const,
        createdBy: null,
        createdAt: relativeIso(-30),
      },
      {
        id: 'redirect-studio-offer',
        tenantId: 'tenant-studio',
        fromPath: '/offer',
        targetKind: 'path' as const,
        targetId: null,
        targetPath: '/my',
        permanent: false,
        origin: 'manual' as const,
        createdBy: creatorUserIds.get('tenant-studio') ?? null,
        createdAt: relativeIso(-2),
      },
    ])
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
    ])
    .onConflictDoNothing();

  await db
    .insert(products)
    .values([
      {
        id: 'product-studio-course-101',
        tenantId: 'tenant-studio',
        type: 'course',
        slug: 'course-together-101',
        title: 'Together 101 Course',
        description: '',
        priceCents: 19900,
        currency: 'PLN',
        published: true,
        accessItems: [],
        createdAt: nextIso(),
      },
      {
        id: 'product-studio-workshop',
        tenantId: 'tenant-studio',
        type: 'course',
        slug: 'workshop-scenario',
        title: 'Scenario Workshop',
        description: '',
        priceCents: 49900,
        currency: 'PLN',
        published: false,
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
    id: 'grant-studio-active-workbook',
    tenantId: 'tenant-studio',
    memberId: 'member-studio-active',
    productId: 'product-download-workbook',
    startsAt: relativeIso(-12),
    expiresAt: null,
  });

  grantSpecs.push({
    id: 'grant-studio-active-club',
    tenantId: 'tenant-studio',
    memberId: 'member-studio-active',
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
      fileName: 'workbook-creator.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2_416_640,
      storageKey: 'product-downloads/product-download-workbook/download-asset-workbook/workbook-creator.pdf',
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
      bannedReason: 'Repeated advertising in the community',
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
        reason: 'Repeated advertising in the community',
        actorUserId: creatorUserIds.get('tenant-studio') ?? 'user-studio-creator',
      },
      occurredAt: seededBanAt,
    })
    .onConflictDoNothing();

  await db
    .insert(marketingConsents)
    .values({
      id: 'marketing-consent-studio-confirmed', tenantId: 'tenant-studio',
      memberId: 'member-studio-active', email: 'student.active@together.dev',
      definitionId: 'consent-definition-studio-news', definitionVersion: 1,
      wordingSnapshot: 'I would like to receive news by email',
      documentRefSnapshot: { mode: 'url', url: 'https://studio.example.test/privacy' },
      status: 'confirmed', previousId: null, source: 'checkout',
      evidence: { collectedAt: relativeIso(-20), proofRef: 'seeded-checkout' },
      occurredAt: relativeIso(-20),
    })
    .onConflictDoNothing();

  await db
    .insert(campaigns)
    .values([
      {
        id: 'campaign-studio-observability', tenantId: 'tenant-studio', name: 'Course launch',
        subject: 'Your learning plan for July', bodyHtml: '<p>Learning plan</p>', bodySource: '<p>Learning plan</p>',
        layoutId: null, consentDefinitionId: 'consent-definition-studio-news', audienceFilter: null,
        status: 'finished', sendAt: relativeIso(-4), snapshotMaxMemberId: 'member-studio-active',
        cursorMemberId: 'member-studio-active', toSend: 1, sent: 1, failed: 0,
        lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null,
        audienceNameSnapshot: 'All eligible members', consentLabelSnapshot: 'I would like to receive news by email',
        startedAt: relativeIso(-4), finishedAt: relativeIso(-4), createdAt: relativeIso(-5),
      },
      {
        id: 'campaign-studio-summer-recap', tenantId: 'tenant-studio', name: 'Summer recap',
        subject: 'Everything you missed in June', bodyHtml: '<p>Six lessons, one workshop and a new space.</p>',
        bodySource: 'Six lessons, one workshop and a new space.',
        layoutId: null, consentDefinitionId: 'consent-definition-studio-news',
        audienceVersion: 2,
        audience: { version: 2, includeLists: [], excludeLists: [], excludeProductIds: ['product-studio-workshop'], includeMembersWithConsent: true },
        audienceFilter: null, candidateCount: 7, skipped: 1,
        status: 'finished', sendAt: relativeIso(-12), snapshotMaxMemberId: null,
        cursorMemberId: null, toSend: 7, sent: 5, failed: 1,
        lockedUntil: null, lockedBy: null, errorCount: 1, pausedReason: null,
        audienceNameSnapshot: 'Members with consent', consentLabelSnapshot: 'I would like to receive news by email',
        startedAt: relativeIso(-12), finishedAt: relativeIso(-12), createdAt: relativeIso(-13),
      },
      {
        id: 'campaign-studio-launch-wave', tenantId: 'tenant-studio', name: 'Autumn launch wave',
        subject: 'Doors open on Monday', bodyHtml: '<p>The autumn cohort opens on Monday.</p>',
        bodySource: 'The autumn cohort opens on Monday.',
        layoutId: null, consentDefinitionId: 'consent-definition-studio-news', audienceFilter: null,
        status: 'running', sendAt: relativeIso(-9), snapshotMaxMemberId: 'member-studio-subscriber',
        cursorMemberId: 'member-studio-active', toSend: 5, sent: 2, failed: 0,
        lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null,
        audienceNameSnapshot: 'All eligible members', consentLabelSnapshot: 'I would like to receive news by email',
        startedAt: relativeIso(-9), finishedAt: null, createdAt: relativeIso(-10),
      },
    ])
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
      {
        id: 'scheduler-run-studio-idle', kind: 'marketing_tick', trigger: 'cron',
        startedAt: relativeIso(-0.15), finishedAt: relativeIso(-0.15), durationMs: 96,
        status: 'completed', idle: true, error: null,
        totals: {
          campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0, reEnqueued: false,
        },
        createdAt: relativeIso(-0.15),
      },
      {
        id: 'scheduler-run-studio-recap', kind: 'marketing_tick', trigger: 'cron',
        startedAt: relativeIso(-12), finishedAt: relativeIso(-12), durationMs: 2_140,
        status: 'completed', error: null,
        totals: {
          campaignsTouched: 1, sendsAttempted: 7, sent: 5, failed: 1, skipped: 1, reEnqueued: false,
        },
        createdAt: relativeIso(-12),
      },
      {
        id: 'scheduler-run-studio-launch', kind: 'marketing_tick', trigger: 'cron',
        startedAt: relativeIso(-9), finishedAt: relativeIso(-9), durationMs: 1_180,
        status: 'completed', error: null,
        totals: {
          campaignsTouched: 1, sendsAttempted: 2, sent: 2, failed: 0, skipped: 0, reEnqueued: true,
        },
        createdAt: relativeIso(-9),
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
      {
        id: 'scheduler-run-tenant-studio-idle', runId: 'scheduler-run-studio-idle',
        tenantId: 'tenant-studio', campaignsTouched: 0, batchSize: 0, sent: 0, failed: 0, skipped: 0,
        budgetComputed: 25, budgetUsed: 0, errors: [], createdAt: relativeIso(-0.15),
      },
      {
        id: 'scheduler-run-tenant-studio-recap', runId: 'scheduler-run-studio-recap',
        tenantId: 'tenant-studio', campaignsTouched: 1, batchSize: 7, sent: 5, failed: 1, skipped: 1,
        budgetComputed: 25, budgetUsed: 7, errors: ['Recipient mailbox is full'], createdAt: relativeIso(-12),
      },
      {
        id: 'scheduler-run-tenant-studio-launch', runId: 'scheduler-run-studio-launch',
        tenantId: 'tenant-studio', campaignsTouched: 1, batchSize: 2, sent: 2, failed: 0, skipped: 0,
        budgetComputed: 25, budgetUsed: 2, errors: [], createdAt: relativeIso(-9),
      },
    ])
    .onConflictDoNothing();

  interface BroadcastSendSpec {
    id: string;
    campaignId: string;
    runId: string | null;
    subject: string;
    email: string;
    days: number;
    status: 'pending' | 'sent' | 'failed' | 'skipped';
    deliveryStatus: 'delivered' | 'bounced' | 'complained' | null;
    skipReason: 'unsubscribed' | null;
  }

  const recapSend = (id: string, email: string, status: BroadcastSendSpec['status'], deliveryStatus: BroadcastSendSpec['deliveryStatus'], skipReason: BroadcastSendSpec['skipReason'] = null): BroadcastSendSpec => ({
    id, campaignId: 'campaign-studio-summer-recap', runId: 'scheduler-run-studio-recap',
    subject: 'Everything you missed in June', email, days: -12, status, deliveryStatus, skipReason,
  });
  const launchSend = (id: string, email: string, status: BroadcastSendSpec['status'], deliveryStatus: BroadcastSendSpec['deliveryStatus']): BroadcastSendSpec => ({
    id, campaignId: 'campaign-studio-launch-wave', runId: status === 'pending' ? null : 'scheduler-run-studio-launch',
    subject: 'Doors open on Monday', email, days: -9, status, deliveryStatus, skipReason: null,
  });
  const broadcastSends: BroadcastSendSpec[] = [
    recapSend('send-studio-recap-1', 'recap.reader1@together.dev', 'sent', 'delivered'),
    recapSend('send-studio-recap-2', 'recap.reader2@together.dev', 'sent', 'delivered'),
    recapSend('send-studio-recap-3', 'recap.reader3@together.dev', 'sent', 'delivered'),
    recapSend('send-studio-recap-4', 'recap.reader4@together.dev', 'sent', 'bounced'),
    recapSend('send-studio-recap-5', 'recap.reader5@together.dev', 'sent', 'complained'),
    recapSend('send-studio-recap-6', 'recap.reader6@together.dev', 'failed', null),
    recapSend('send-studio-recap-7', 'recap.reader7@together.dev', 'skipped', null, 'unsubscribed'),
    launchSend('send-studio-launch-1', 'launch.reader1@together.dev', 'sent', 'delivered'),
    launchSend('send-studio-launch-2', 'launch.reader2@together.dev', 'sent', null),
    launchSend('send-studio-launch-3', 'launch.reader3@together.dev', 'pending', null),
    launchSend('send-studio-launch-4', 'launch.reader4@together.dev', 'pending', null),
    launchSend('send-studio-launch-5', 'launch.reader5@together.dev', 'pending', null),
  ];

  await db
    .insert(campaignSends)
    .values([
      {
        id: 'send-studio-marketing', tenantId: 'tenant-studio', campaignId: 'campaign-studio-observability',
        runId: 'scheduler-run-studio-marketing',
        source: 'broadcast', memberId: 'member-studio-active', email: 'student.active@together.dev',
        subject: 'Your learning plan for July', consentRowId: 'marketing-consent-studio-confirmed',
        unsubscribeTokenId: null, status: 'sent', skipReason: null, sesMessageId: 'ses-studio-marketing',
        deliveryStatus: 'delivered', deliveryOccurredAt: relativeIso(-4), idempotencySource: null,
        renderedBodyPurgedAt: null, createdAt: relativeIso(-4), sentAt: relativeIso(-4),
      },
      ...broadcastSends.map((send) => ({
        id: send.id, tenantId: 'tenant-studio', campaignId: send.campaignId, runId: send.runId,
        source: 'broadcast' as const, memberId: null, email: send.email,
        subject: send.subject, consentRowId: null,
        unsubscribeTokenId: null, status: send.status, skipReason: send.skipReason,
        sesMessageId: send.status === 'sent' ? `ses-${send.id}` : null,
        deliveryStatus: send.deliveryStatus,
        deliveryOccurredAt: send.deliveryStatus === null ? null : relativeIso(send.days),
        idempotencySource: null, renderedBodyPurgedAt: null,
        createdAt: relativeIso(send.days),
        sentAt: send.status === 'sent' ? relativeIso(send.days) : null,
      })),
    ])
    .onConflictDoNothing();

  await db
    .insert(emailOutbox)
    .values({
      id: 'send-studio-transactional', tenantId: 'tenant-studio', kind: 'welcome-sign-in',
      to: 'student.active@together.dev',
      payload: {
        kind: 'welcome-sign-in', language: 'en', tenantName: 'Studio Demo',
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
    { id: 'price-product-studio-course-101', tenantId: 'tenant-studio', productId: 'product-studio-course-101', kind: 'one_time', interval: null, amountCents: 19900 },
    { id: 'price-product-studio-workshop', tenantId: 'tenant-studio', productId: 'product-studio-workshop', kind: 'one_time', interval: null, amountCents: 49900 },
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
        id: 'subscription-studio-subscriber',
        tenantId: 'tenant-studio',
        memberId: 'member-studio-subscriber',
        productId: 'product-club',
        priceId: 'price-club-monthly',
        provider: 'simulated' as const,
        providerSubscriptionId: 'sim_sub_seed_subscriber',
        status: 'active' as const,
        currentPeriodEnd: relativeIso(20),
        cancelAtPeriodEnd: false,
        createdAt: relativeIso(-40),
        updatedAt: relativeIso(-10),
      },
      {
        id: 'subscription-studio-active-club',
        tenantId: 'tenant-studio',
        memberId: 'member-studio-active',
        productId: 'product-club',
        priceId: 'price-club-monthly',
        provider: 'stripe' as const,
        providerSubscriptionId: 'sub_seed_active_club',
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
      id: 'order-studio-active-js',
      memberId: 'member-studio-active',
      productId: 'product-js-full',
      priceId: 'price-product-js-full',
      kind: 'one_time',
      status: 'paid',
      provider: 'simulated',
      amountCents: 39900,
      providerObjectIds: { checkoutSession: 'sim_cs_seed_active' },
      createdAt: relativeIso(-30),
    },
    {
      id: 'order-studio-active-club',
      memberId: 'member-studio-active',
      productId: 'product-club',
      priceId: 'price-club-monthly',
      kind: 'recurring',
      status: 'paid',
      provider: 'stripe',
      amountCents: 4900,
      providerObjectIds: { checkoutSession: 'cs_seed_active_club', subscription: 'sub_seed_active_club' },
      createdAt: relativeIso(-20),
    },
    {
      id: 'order-studio-module-dom',
      memberId: 'member-studio-module',
      productId: 'product-js-dom-module',
      priceId: 'price-product-js-dom-module',
      kind: 'one_time',
      status: 'paid',
      provider: 'simulated',
      amountCents: 9900,
      providerObjectIds: { checkoutSession: 'sim_cs_seed_module' },
      createdAt: relativeIso(-14),
    },
    {
      id: 'order-studio-subscriber-start',
      memberId: 'member-studio-subscriber',
      productId: 'product-club',
      priceId: 'price-club-monthly',
      kind: 'recurring',
      status: 'paid',
      provider: 'simulated',
      amountCents: 4900,
      providerObjectIds: { checkoutSession: 'sim_cs_seed_subscriber', subscription: 'sim_sub_seed_subscriber' },
      createdAt: relativeIso(-40),
    },
    {
      id: 'order-studio-subscriber-cycle-1',
      memberId: 'member-studio-subscriber',
      productId: 'product-club',
      priceId: 'price-club-monthly',
      kind: 'recurring',
      status: 'paid',
      provider: 'simulated',
      amountCents: 4900,
      providerObjectIds: { invoice: 'sim_in_seed_subscriber_1', subscription: 'sim_sub_seed_subscriber' },
      createdAt: relativeIso(-10),
    },
    {
      id: 'order-studio-subscriber-retry',
      memberId: 'member-studio-subscriber',
      productId: 'product-club',
      priceId: 'price-club-monthly',
      kind: 'recurring',
      status: 'failed',
      provider: 'simulated',
      amountCents: 4900,
      providerObjectIds: { invoice: 'sim_in_seed_subscriber_fail', subscription: 'sim_sub_seed_subscriber' },
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
    .where(eq(orders.id, 'order-studio-active-js'));

  await db
    .insert(couponRedemptions)
    .values({
      id: 'coupon-redemption-studio-partner20',
      tenantId: 'tenant-studio',
      couponId: 'coupon-studio-partner20',
      orderId: 'order-studio-active-js',
      memberId: 'member-studio-active',
      email: 'student.active@together.dev',
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
      orderId: 'order-studio-active-js',
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
      providerSessionId: 'sim_cs_seed_active',
      memberEmail: 'student.active@together.dev',
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
        id: 'member-event-studio-active-email',
        tenantId: 'tenant-studio',
        memberId: 'member-studio-active',
        type: 'email-sent',
        payload: {
          sendId: 'send-studio-marketing',
          mailKind: 'marketing',
          subject: 'JavaScript course updates',
          source: 'broadcast',
          transport: 'tenant-ses',
        },
        occurredAt: relativeIso(-4),
      },
      {
        id: 'member-event-studio-active-lesson',
        tenantId: 'tenant-studio',
        memberId: 'member-studio-active',
        type: 'lesson-completion',
        payload: { courseId: 'course-js', lessonId: 'lesson-js-variables-2' },
        occurredAt: relativeIso(-5),
      },
      {
        id: 'member-event-studio-active-subscription',
        tenantId: 'tenant-studio',
        memberId: 'member-studio-active',
        type: 'subscription-change',
        payload: {
          subscriptionId: 'subscription-studio-active-club',
          productId: 'product-club',
          status: 'active',
          currentPeriodEnd: relativeIso(10),
          cancelAtPeriodEnd: false,
          provider: 'stripe',
        },
        occurredAt: relativeIso(-2),
      },
      {
        id: 'member-event-studio-active-club-purchase',
        tenantId: 'tenant-studio',
        memberId: 'member-studio-active',
        type: 'purchase',
        payload: {
          orderId: 'order-studio-active-club',
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
        id: 'member-event-studio-active-club-grant',
        tenantId: 'tenant-studio',
        memberId: 'member-studio-active',
        type: 'grant',
        payload: {
          grantId: 'grant-studio-active-club',
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

  const activeUserId = memberUserId('member-studio-active');
  const freeUserId = memberUserId('member-studio-free');
  const expiredUserId = memberUserId('member-studio-expired');
  const moduleUserId = memberUserId('member-studio-module');

  const discussionPosts: SeedPostDef[] = [
    {
      id: 'post-js-variables-tip',
      contextId: 'lesson-js-variables-1',
      parentPostId: null,
      rootPostId: 'post-js-variables-tip',
      authorUserId: expiredUserId,
      authorDisplay: 'Expired Student',
      authorIsStaff: false,
      body: 'A quick tip: try the examples from this lesson in the browser console (F12 → Console). You can immediately see how const prevents reassignment.\nResources: https://courses.example.org/guide?topic=const&level=1.',
      createdAt: relativeIso(-20),
      deletedAt: null,
    },
    {
      id: 'post-js-variables-tip-r1',
      contextId: 'lesson-js-variables-1',
      parentPostId: 'post-js-variables-tip',
      rootPostId: 'post-js-variables-tip',
      authorUserId: freeUserId,
      authorDisplay: 'Free Account',
      authorIsStaff: false,
      body: 'Thanks, that helped!',
      createdAt: relativeIso(-19),
      deletedAt: relativeIso(-18),
    },
    {
      id: 'post-js-variables-q',
      contextId: 'lesson-js-variables-1',
      parentPostId: null,
      rootPostId: 'post-js-variables-q',
      authorUserId: activeUserId,
      authorDisplay: 'Active Student',
      authorIsStaff: false,
      body: 'Is there still a reason to use var? Older YouTube tutorials use it everywhere, but this lesson only uses let and const. Should I rewrite the older examples or skip them?',
      createdAt: relativeIso(-3),
      deletedAt: null,
    },
    {
      id: 'post-js-variables-q-r1',
      contextId: 'lesson-js-variables-1',
      parentPostId: 'post-js-variables-q',
      rootPostId: 'post-js-variables-q',
      authorUserId: freeUserId,
      authorDisplay: 'Free Account',
      authorIsStaff: false,
      body: 'I had the same question. I started with a course from a few years ago that used var throughout. Rewriting the examples with const and let makes it much easier to spot where a value actually changes.',
      createdAt: relativeIso(-2),
      deletedAt: null,
    },
    {
      id: 'post-js-variables-q-r2',
      contextId: 'lesson-js-variables-1',
      parentPostId: 'post-js-variables-q-r1',
      rootPostId: 'post-js-variables-q',
      authorUserId: studioCreatorUserId,
      authorDisplay: 'Studio Creator',
      authorIsStaff: true,
      body: 'Good question! In new code, use const by default and let where you need to reassign a value. Rewriting older examples is a useful exercise, and understanding var will help you read existing code.',
      createdAt: relativeIso(-1),
      deletedAt: null,
    },
    {
      id: 'post-js-dom-q',
      contextId: 'lesson-js-dom-1',
      parentPostId: null,
      rootPostId: 'post-js-dom-q',
      authorUserId: moduleUserId,
      authorDisplay: 'Module Student',
      authorIsStaff: false,
      body: 'I got stuck on querySelectorAll: it returns a NodeList, so map did not work. Array.from(list) solved it. Is there a reason the browser does not return a regular array?',
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
      body: 'Good observation! NodeList is a long-standing DOM interface with its own API. Array.from or the spread syntax [...list] gives you an array with methods such as map. We use that approach later in the lesson.',
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
    { userId: expiredUserId, rootPostId: 'post-js-variables-tip', createdAt: relativeIso(-20) },
    { userId: freeUserId, rootPostId: 'post-js-variables-tip', createdAt: relativeIso(-19) },
    { userId: activeUserId, rootPostId: 'post-js-variables-q', createdAt: relativeIso(-3) },
    { userId: freeUserId, rootPostId: 'post-js-variables-q', createdAt: relativeIso(-2) },
    { userId: studioCreatorUserId, rootPostId: 'post-js-variables-q', createdAt: relativeIso(-1) },
    { userId: moduleUserId, rootPostId: 'post-js-dom-q', createdAt: relativeIso(-10) },
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
      id: 'notif-active-variables-r1',
      postId: 'post-js-variables-q-r1',
      authorDisplay: 'Free Account',
      createdAt: relativeIso(-2),
      readAt: relativeIso(-1.5),
    },
    {
      id: 'notif-active-variables-r2',
      postId: 'post-js-variables-q-r2',
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
        recipientUserId: activeUserId,
        kind: 'thread-reply' as const,
        payload: {
          rootPostId: 'post-js-variables-q',
          postId: notification.postId,
          contextKind: 'lesson',
          contextId: 'lesson-js-variables-1',
          courseId: 'course-js',
          lessonName: 'Declaring variables',
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
      id: 'space-studio-community',
      slug: 'community',
      name: 'Community',
      description:
        'An open space for all members. Introduce yourself and connect with other learners.',
      visibility: 'members',
      productIds: [],
      publicReadOnly: true,
      position: 0,
    },
    {
      id: 'space-studio-club-js',
      slug: 'club-js',
      name: 'JavaScript Club',
      description:
        'A space for full JavaScript course members to share projects, review code, and take on challenges.',
      visibility: 'product',
      productIds: ['product-js-full'],
      position: 1,
    },
    {
      id: 'space-studio-club-react',
      slug: 'club-react',
      name: 'React Club',
      description:
        'A space for React in Practice members to share projects, ask questions, and review code.',
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
      id: 'post-community-hello',
      contextId: 'space-studio-community',
      parentPostId: null,
      rootPostId: 'post-community-hello',
      authorUserId: studioCreatorUserId,
      authorDisplay: 'Studio Creator',
      authorIsStaff: true,
      body: 'Welcome to the Community! This space is open to all members. Introduce yourself in the replies and tell us what you are learning.',
      createdAt: relativeIso(-14),
      deletedAt: null,
    },
    {
      id: 'post-community-hello-r1',
      contextId: 'space-studio-community',
      parentPostId: 'post-community-hello',
      rootPostId: 'post-community-hello',
      authorUserId: activeUserId,
      authorDisplay: 'Active Student',
      authorIsStaff: false,
      body: 'Hi! I am working through the DOM module and putting together my first project: a habit tracker.',
      createdAt: relativeIso(-13),
      deletedAt: null,
    },
    {
      id: 'post-community-resources',
      contextId: 'space-studio-community',
      parentPostId: null,
      rootPostId: 'post-community-resources',
      authorUserId: freeUserId,
      authorDisplay: 'Free Account',
      authorIsStaff: false,
      body: 'A resource recommendation: javascript.info complements the course lessons really well. What other learning resources do you enjoy?',
      createdAt: relativeIso(-6),
      deletedAt: null,
    },
    {
      id: 'post-club-challenge',
      contextId: 'space-studio-club-js',
      parentPostId: null,
      rootPostId: 'post-club-challenge',
      authorUserId: studioCreatorUserId,
      authorDisplay: 'Studio Creator',
      authorIsStaff: true,
      body: 'This week’s challenge: write a function that flattens an arbitrarily nested array without using Array.prototype.flat. Share your solutions in the replies!',
      createdAt: relativeIso(-4),
      deletedAt: null,
    },
    {
      id: 'post-club-challenge-r1',
      contextId: 'space-studio-club-js',
      parentPostId: 'post-club-challenge',
      rootPostId: 'post-club-challenge',
      authorUserId: activeUserId,
      authorDisplay: 'Active Student',
      authorIsStaff: false,
      body: 'Here is my version using recursion and reduce: reduce((acc, el) => acc.concat(Array.isArray(el) ? flatten(el) : el), []). It also works with empty arrays.',
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
      id: 'report-studio-resources',
      tenantId: 'tenant-studio',
      postId: 'post-community-resources',
      reporterUserId: activeUserId,
      reporterDisplay: 'Active Student',
      source: 'member',
      reason: 'off-topic',
      note: 'This post looks like an advertisement for an external service.',
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
      id: 'report-event-studio-resources-opened',
      tenantId: 'tenant-studio',
      reportId: 'report-studio-resources',
      postId: 'post-community-resources',
      type: 'opened',
      occurredAt: relativeIso(-5),
    })
    .onConflictDoNothing();

  const reactionDefs: Array<{ postId: string; userId: string; emoji: string; createdAt: string }> = [
    { postId: 'post-community-hello', userId: activeUserId, emoji: '👍', createdAt: relativeIso(-13) },
    { postId: 'post-community-hello', userId: freeUserId, emoji: '👍', createdAt: relativeIso(-12) },
    { postId: 'post-community-hello', userId: moduleUserId, emoji: '🎉', createdAt: relativeIso(-12) },
    { postId: 'post-community-resources', userId: activeUserId, emoji: '💡', createdAt: relativeIso(-5) },
    { postId: 'post-community-resources', userId: studioCreatorUserId, emoji: '❤️', createdAt: relativeIso(-5) },
    { postId: 'post-club-challenge', userId: activeUserId, emoji: '🎉', createdAt: relativeIso(-4) },
    { postId: 'post-club-challenge-r1', userId: studioCreatorUserId, emoji: '👍', createdAt: relativeIso(-3) },
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
    { userId: activeUserId, spaceId: 'space-studio-community', createdAt: relativeIso(-14) },
    { userId: freeUserId, spaceId: 'space-studio-community', createdAt: relativeIso(-10) },
    { userId: studioCreatorUserId, spaceId: 'space-studio-community', createdAt: relativeIso(-14) },
    { userId: activeUserId, spaceId: 'space-studio-club-js', createdAt: relativeIso(-4) },
    { userId: studioCreatorUserId, spaceId: 'space-studio-club-js', createdAt: relativeIso(-4) },
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
        { userId: studioCreatorUserId, rootPostId: 'post-community-hello', createdAt: relativeIso(-14) },
        { userId: activeUserId, rootPostId: 'post-community-hello', createdAt: relativeIso(-13) },
        { userId: freeUserId, rootPostId: 'post-community-resources', createdAt: relativeIso(-6) },
        { userId: studioCreatorUserId, rootPostId: 'post-club-challenge', createdAt: relativeIso(-4) },
        { userId: activeUserId, rootPostId: 'post-club-challenge', createdAt: relativeIso(-3) },
      ].map((subscription) => ({
        tenantId: 'tenant-studio',
        userId: subscription.userId,
        rootPostId: subscription.rootPostId,
        createdAt: subscription.createdAt,
        mutedAt: null,
      })),
    )
    .onConflictDoNothing();

  const smokeTenant = await applySmokeTenantSeed(db, {
    users,
    passwords: { member: PASSWORD, creator: PASSWORD },
    nextIso,
    relativeIso,
  });

  return {
    password: PASSWORD,
    creators: [
      ...creators.map((creator) => ({
        email: creator.email,
        tenantSlug: creator.tenant.slug,
      })),
      smokeTenant.creator,
    ],
    members: [
      ...memberSpecs.map((member) => ({
        email: member.email,
        tenantId: member.tenantId,
      })),
      ...smokeTenant.members,
    ],
  };
};
