# Playwright Automation Testing — Design Doc

Integration of Playwright-driven E2E testing into the React Admin Panel + ABP backend, supporting predefined scripts, pasted custom scripts, and dynamic quiz-based test generation.

> **Status: implemented, with gaps.** This document was updated after the first working end-to-end run
> to describe what actually ships. Sections marked **[Deferred]** were designed but not built; §12
> lists every deviation from the original design and why. Anything not marked is in the code today.

## 1. Goals

1. Run predefined Playwright scripts from the admin panel and show results. — **done**
2. Dynamically generate a Playwright script from Quiz/Question repository data (turn quiz data into JSON, inject into a skeleton template, execute). — **built, selectors unverified (§11)**
3. Support headless or headed (visible Chromium) execution, selectable per run. — **done**, gated by config (§9)

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Admin Panel (Frontend)                 │
│  AutomationTestControlPage.tsx                                  │
│   ├─ Tests tab + Runs tab                                        │
│   ├─ CreateEditAutomationTestModal (tabbed)                      │
│   ├─ ExecutionConsoleModal (log / script / artifacts)            │
│   └─ Polling-based results display                              │
└───────────────────────────┬───────────────────────────────────────┘
                            │ HTTP (ABP dynamic API), polled
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│            ABP Backend (AutomationTestingAppService)            │
│  Request Handler                                                 │
│   ├─ CreateAutomationTest / UpdateAutomationTest                 │
│   ├─ DeleteAutomationTest / GetAutomationTestForEdit             │
│   ├─ GetAutomationTests                                          │
│   ├─ ExecuteAutomationTest   (one entry point, all test types)   │
│   ├─ GenerateQuizTestScript  (preview only)                      │
│   ├─ FetchTestingResults / GetTestingResult                      │
│   └─ StopTest                                                    │
│                          ▼                                       │
│  Hangfire: AutomationTestRunJob  ◄── owns one run end to end     │
│   ├─ ExecuteAsync(testingResultId)                               │
│   └─ ExecuteScheduledAsync(automationTestId)                     │
│                          ▼                                       │
│  Test Generation Engine                                          │
│   ├─ QuizTestScriptBuilder      (quiz data → actions)            │
│   └─ PlaywrightScriptGeneratorService ({{TOKEN}} substitution)   │
│                          ▼                                       │
│  Repositories                                                     │
│   ├─ IAutomationTestRepository / ITestingResultRepository        │
│   └─ existing IQuizRepository / IQuizQuestionRepository /        │
│      IAnswerRepository (read-only)                               │
│                          ▼                                       │
│  PlaywrightExecutorService                                        │
│   ├─ Child process (npx playwright test …)                       │
│   ├─ Headless/Headed flag                                        │
│   ├─ stdout/stderr → channel → periodic DB flush                 │
│   └─ Timeout + cooperative cancel + process-tree kill            │
└────────────┬────────────────────────────────┬─────────────────────┘
             │                                │
             ▼                                ▼
    ┌──────────────────┐         ┌──────────────────────────┐
    │  Database         │         │  Playwright Runtime       │
    │   ├─ AutomationTests│       │   ├─ Chromium             │
    │   └─ AutomationTesting      │   ├─ Script Execution     │
    │      Results        │       │   └─ Screenshot/Video/    │
    │                     │       │      Trace capture        │
    └──────────────────┘         └──────────────────────────┘
```

**The run is asynchronous.** A quiz run takes minutes, so `ExecuteAutomationTest` only inserts a
`Pending` row and queues a Hangfire job, then returns immediately. The job flips the row to `Running`,
streams output into it, and writes the verdict. The front end polls.

## 3. Data Models / Entities

Two tables, not five. The original per-type tables (`PredefinedTest`, `DynamicQuizTest`) were folded
into `AutomationTest`, and `PlaywrightTemplate` was dropped in favour of template files on disk — see
§12.1.

### 3.1 `AutomationTest` (test definition — table `AutomationTests`)

`FullAuditedEntity` (int key), namespace `CTH.QuizSystem.AutomationTesting`.

| Field | Type | Notes |
|---|---|---|
| Id | int | |
| Name | string(255) | |
| Description | string | |
| TestType | enum | `Predefined=1`, `QuizBased=2`, `Custom=3` |
| IsActive | bool | inactive tests never run, on schedule or on demand |
| ScriptPath | string(512) | `Predefined`: path relative to the script root |
| ScriptContent | string | `Custom`: the whole `.spec.ts` body, stored inline |
| QuizIdsJson | string | `QuizBased`: JSON array of Quiz ids, run in order |
| AnswerStrategy | enum | `AllCorrect=1`, `Random=2`, `Specific=3` |
| AnswerMappingJson | string | JSON `QuestionId → AnswerId`, read only when `Specific` |
| SkipQuestionIdsJson | string | JSON array of Question ids to leave blank |
| TestUserName | string(256) | |
| TestPasswordEncrypted | string(1024) | `SimpleStringCipher`; never mapped onto a DTO |
| BaseUrl | string(512) | overrides the configured default |
| Headless | bool | |
| TimeoutSeconds | int | 0 = use configured default |
| RetryCount | int | passed through as `--retries` |
| CaptureArtifacts | bool | |
| ScheduledAt | DateTime? | one-shot; cleared once the run is queued |
| ScheduledHangfireJobId | string(256) | so an edit can cancel/reschedule |
| TagsJson | string | JSON array of strings |
| + `FullAuditedEntity` columns | | CreationTime, CreatorUserId, LastModification*, IsDeleted, … |

### 3.2 `TestingResult` (one execution — table `AutomationTestingResults`)

`Entity<int>, IHasCreationTime`. Rows are created `Pending` and **updated in place** as the run
progresses, which is what makes polling show a growing log.

| Field | Type | Notes |
|---|---|---|
| Id | int | |
| AutomationTestId | FK | cascade delete in SQL |
| Status | enum | `Pending`, `Running`, `Passed`, `Failed`, `TimedOut`, `Cancelled`, `Error` |
| CreationTime | DateTime | when **queued** |
| StartedAt / FinishedAt | DateTime? | when the process actually started / ended |
| DurationMs | int? | process wall-clock, excludes queue time |
| Headless | bool | resolved per run, can override the definition |
| ScriptPath | string(512) | what actually ran, relative to the script root |
| GeneratedScript | string | the emitted body (null for `Predefined`); carries no secrets |
| Stdout / Stderr | string | flushed every ~2s while running, capped at 512 KB |
| ErrorMessage | string(2000) | short reason for a non-`Passed` verdict |
| ExitCode | int? | |
| PassedCount / FailedCount | int | parsed from the `line` reporter summary |
| ArtifactsJson | string | JSON array of artifact paths relative to the script root |
| ExecutedByUserId | long? | |
| HangfireJobId | string(256) | set while queued, so a `Pending` run can be cancelled |
| CancellationRequested | bool | set by `StopTest`; the job polls it and kills the process |

`IsFinished` is a `[NotMapped]` convenience (`Status` is neither `Pending` nor `Running`).

### 3.3 **[Deferred]** `PlaywrightTemplate`

Templates are files under `Templates/` in the script root, loaded by name with a built-in fallback
constant. No table, no CRUD screen. Adding one later only changes where
`PlaywrightScriptGeneratorService` reads the template text from.

## 4. Frontend Design (React Admin Panel)

### 4.1 Screens

- **`AutomationTestControlPage`** — summary cards (passed / failed / in-progress / avg duration), shared
  filter bar, and two tabs:
  - *Kịch bản (Tests)* — name, type badge, tags, active switch, latest-run badge, success rate, and
    row actions: run, stop, view last log, edit, delete.
  - *Lần chạy (Runs)* — every execution with status, passed/failed counts, duration, who ran it.
- **`CreateEditAutomationTestModal`** — three tabs (*Thông tin chung* / *Cấu hình kịch bản* / *Nâng cao*)
  rather than the five originally sketched. The config tab swaps its body on `TestType`. Footer offers
  **Lưu** and **Lưu & chạy ngay**. Quiz-based tests get a **Xem trước script** button that calls
  `GenerateQuizTestScript` and shows the rendered spec.
- **`ExecutionConsoleModal`** — polls one run and shows Output / Lỗi / Script / Artifacts tabs, with
  live tail-following while running and a Stop button.

### 4.2 Frontend file layout (as built)

```
AdminPanel/src/features/testing/
├─ pages/
│  └─ AutomationTestControlPage.tsx
├─ components/
│  ├─ CreateEditAutomationTestModal.tsx   # absorbs TestTypeSelector + both type forms
│  ├─ AutomationTestListItem.tsx
│  ├─ TestingResultListItem.tsx
│  ├─ ExecutionConsoleModal.tsx
│  └─ TestStatusBadge.tsx
├─ hooks/
│  └─ useTesting.tsx                      # all queries/mutations, incl. useFetchTestingResults
├─ types/
│  └─ automationTest.types.ts             # DTOs + enums + label maps
└─ utils/
   ├─ errorMessage.ts
   └─ format.ts
```

API calls live in the shared `AdminPanel/src/services/abpService.ts` as `automationTestService`,
matching every other feature, rather than a feature-local service file.

Route `/testing/automation`; sidebar entry under **QUẢN TRỊ**, permission `Pages.AutomationTesting`.

## 5. Backend Design

### 5.1 AppService surface (`IAutomationTestingAppService`)

| Method | Returns | Purpose |
|---|---|---|
| `CreateAutomationTest(CreateAutomationTestInput)` | `AutomationTestDto` | Persist; optionally queue or schedule a run |
| `UpdateAutomationTest(UpdateAutomationTestInput)` | `AutomationTestDto` | Edit; re-schedules from scratch |
| `DeleteAutomationTest(EntityDto<int>)` | void | Soft delete; refuses while a run is active |
| `GetAutomationTestForEdit(EntityDto<int>)` | `AutomationTestDto` | |
| `GetAutomationTests(GetAutomationTestsInput)` | `PagedResultDto<AutomationTestDto>` | List + filters + latest-run badge |
| `ExecuteAutomationTest(ExecuteTestInput)` | `TestingResultDto` | Queue a run (any test type), returns the `Pending` row |
| `GenerateQuizTestScript(GenerateScriptInput)` | string | Preview only, no save, no execution |
| `FetchTestingResults(FetchTestingResultsInput)` | `FetchTestingResultsOutput` | Paginated runs + whole-set summary |
| `GetTestingResult(EntityDto<int>)` | `TestingResultDto` | Full detail incl. stdout/stderr/script |
| `StopTest(EntityDto<int>)` | void | Records the cancel request; kills the process |

One `ExecuteAutomationTest` replaces the separate `ExecutePredefinedTest` / `ExecuteDynamicQuizTest` —
the job already branches on `TestType`, so two endpoints bought nothing. `UploadPredefinedScript` is
**[Deferred]**: predefined scripts are placed in the folder by hand or by deploy.

Permissions: `Pages.AutomationTesting` on the class, with `.Create`, `.Edit`, `.Delete` and `.Execute`
(used by both `ExecuteAutomationTest` and `StopTest`) on the relevant methods.

### 5.2 Services

- **`PlaywrightScriptGeneratorService`** — `GenerateFromTemplateAsync(templateName, placeholders)`.
  Replaces `{{TOKEN}}`; unknown tokens collapse to empty rather than leaking a literal `{{FOO}}`.
  Rejects template names containing a path separator or `..`.
- **`QuizTestScriptBuilder`** — `BuildAsync(BuildRequest) → BuildResult { QuizSteps, Assertions, Title,
  UnsupportedQuestions }`. Walks `Approved` questions in `SortOrder`, which is the same filter the
  learner-facing attempt endpoint uses. Only MultipleChoice / TrueFalse / CheckBox are scriptable;
  anything else is emitted as a comment and reported in `UnsupportedQuestions`.
- **`PlaywrightExecutorService`** (`IPlaywrightExecutor` in Core) —
  `RunAsync(request, onOutputLine, cancellationToken) → PlaywrightRunOutcome`. Builds the argument
  list (never a shell string), resolves the executable off `PATH`, streams both pipes through a
  `Channel` to a single consumer, enforces the timeout, and kills the whole process tree.
- **`AutomationTestRunJob`** (Hangfire) — materialises the script, owns the `TestingResult` lifecycle,
  flushes the log every ~2s, and polls `CancellationRequested` on a 3s timer.

### 5.3 Repositories

`IAutomationTestRepository` and `ITestingResultRepository` (both `IBaseRepository<T,int>`). Quiz data is
read through the **existing** `IQuizRepository` / `IQuizQuestionRepository` / `IAnswerRepository` — no
new read-only repositories were introduced.

### 5.4 Backend file layout (as built)

```
CTH.QuizSystem.Core/
└─ AutomationTest/                     # folder is singular; namespace is CTH.QuizSystem.AutomationTesting
   ├─ AutomationTest.cs
   ├─ TestingResult.cs
   ├─ AutomationTestType.cs
   ├─ TestingResultStatus.cs
   ├─ QuizAnswerStrategy.cs
   ├─ IPlaywrightExecutor.cs           # + PlaywrightRunRequest / PlaywrightRunOutcome
   └─ Repositories/
      ├─ IAutomationTestRepository.cs
      └─ ITestingResultRepository.cs

CTH.QuizSystem.Application/
└─ AutomationTesting/
   ├─ AutomationTestingAppService.cs
   ├─ IAutomationTestingAppService.cs
   ├─ Dtos/                            # AutomationTestDto, TestingResultDto, Create/Update inputs,
   │                                   # Fetch/Get inputs, FetchTestingResultsOutput, ExecuteTestInput,
   │                                   # GenerateScriptInput
   ├─ Jobs/AutomationTestRunJob.cs
   └─ Services/
      ├─ AutomationTestingOptions.cs
      ├─ PlaywrightScriptGeneratorService.cs
      ├─ QuizTestScriptBuilder.cs
      └─ PlaywrightExecutorService.cs

CTH.QuizSystem.EntityFrameworkCore/
├─ EntityFrameworkCore/Repositories/AutomationTesting/{AutomationTest,TestingResult}Repository.cs
├─ EntityFrameworkCore/QuizSystemDbContext.cs          # 2 DbSets
└─ Migrations/Scripts/20261012_AutomationTesting.sql   # idempotent; run before deploy

<host>/App_Data/PlaywrightScripts/      # Web.Mvc and Web.Host each have one
├─ package.json            # pins Node via "volta" (§10)
├─ playwright.config.ts
├─ Templates/quiz-template.spec.ts
├─ Predefined/*.spec.ts
├─ Generated/run-{resultId}.spec.ts     # gitignored
└─ Artifacts/{resultId}/...             # gitignored
```

**Script root resolution.** The folder is found via `IAppFolders.PlaywrightScriptsFolder`, set from the
host's **content root** in `QuizSystemWebCoreModule` — so in development it is the project's own
`App_Data`, not a copy under `bin`, and `node_modules` survives a rebuild. Override with
`AutomationTesting:ScriptRoot`. Screenshots and video are **not** separate folders: Playwright's
`--output` directory holds the screenshot, `video.webm` and `trace.zip` for a run together.

## 6. Dynamic Quiz Test — Data Flow

1. User selects **Quiz-Based Test**, picks one or more quizzes.
2. Backend loads `Quiz` + `QuizQuestions` → `Question` → `Answers`, filtered to `QuestionStatus.Approved`.
3. `QuizTestScriptBuilder`:
   - Builds navigation + per-question steps (login steps come from the job, not the builder).
   - For each question (respecting `SkipQuestionIds` and `SortOrder`):
     - Resolves the answer per `AnswerStrategy` (correct / seeded-random / explicit mapping).
     - Emits `page.getByTestId('choice-answer-item-{AnswerId}').click()` — all correct options for
       CheckBox, exactly one otherwise.
     - Emits the next-question step, except on the last question.
   - Emits submit + confirm-submit steps.
4. `PlaywrightScriptGeneratorService` loads `quiz-template.spec.ts` and injects the steps and assertions.
5. `AutomationTestRunJob` writes the spec to `Generated/run-{id}.spec.ts` and `PlaywrightExecutorService`
   runs `npx playwright test <spec> --reporter=line --output=Artifacts/{id} [--headed] [--retries=N]`.
6. The job flushes stdout/stderr into the `TestingResult` row; `ExecutionConsoleModal` polls and renders
   it, then shows the verdict, artifacts and the exact script that ran.

The `Random` strategy is seeded off the **test id**, so repeated runs of the same test are comparable.

## 7. Playwright Skeleton Template

```typescript
// Templates/quiz-template.spec.ts
import { test, expect } from '@playwright/test';

const baseUrl = process.env.PW_BASE_URL ?? 'http://localhost:3000';
const testUser = process.env.PW_TEST_USER ?? '';
const testPassword = process.env.PW_TEST_PASSWORD ?? '';

test('{{TEST_TITLE}}', async ({ page }) => {
{{LOGIN_STEPS}}

{{QUIZ_STEPS}}

{{ASSERTIONS}}
});
```

Tokens: `TEST_TITLE`, `LOGIN_STEPS`, `QUIZ_STEPS`, `ASSERTIONS`. **Credentials are read from the
environment, never substituted into the text** — that is what lets `TestingResult.GeneratedScript` be
stored and displayed without masking.

`{{QUIZ_STEPS}}` is replaced with generated per-question actions, e.g.:

```typescript
await page.goto(`${baseUrl}/quiz/19116`);
await page.getByTestId('quiz-attempt-btn-19116').click();      // quiz id
await page.getByTestId('choice-answer-item-2313971').click();  // answer id
await page.getByTestId('next-question-btn-1195304').click();   // current question id
// ... one block per question
await page.getByTestId('submit-quiz-btn-1195306').click();     // LAST question id, not the quiz id
await page.getByTestId('submit-confirm-submit-btn').click();
```

## 8. Real-Time Communication — **[Deferred]**

SignalR was designed but **not implemented**. Instead the job persists stdout/stderr to the
`TestingResult` row every ~2 seconds and the client polls:

- `useFetchTestingResults` re-fetches every 3s while `summary.inProgressCount > 0`, then stops.
- `useTestingResult` re-fetches every 2s while `isFinished === false`, then stops.

This keeps the log durable (it survives a page reload or a backend restart, which a pure socket stream
would not) at the cost of up to ~2s of latency. Adding a `TestExecutionHub` later is a transport
change only — the schema and the job already produce everything a hub would push.

## 9. Headless vs. Headed Execution

`Headless` is stored per test and may be overridden per run via `ExecuteTestInput.Headless`. When false
the executor adds `--headed`.

Headed runs need a desktop session; on a headless server they hang until the timeout rather than
failing fast. So they are gated by **`AutomationTesting:AllowHeadedRuns`**, which is `false` in the base
`appsettings.json` and `true` only in `appsettings.Development.json`. With it off, the app service
rejects the request up front with a clear message and the modal disables the toggle.

## 10. Environment & Configuration

```json
"AutomationTesting": {
  "ScriptRoot": "",                 // blank = <content root>/App_Data/PlaywrightScripts
  "BaseUrl": "http://localhost:3000",
  "NodeExecutable": "npx",
  "DefaultTimeoutSeconds": 300,
  "AllowHeadedRuns": false
}
```

**Node resolution.** `npx` is `npx.cmd` under the official Node MSI but `npx.exe` under Volta and nvm,
so the executor searches `PATH` for `.exe`/`.cmd`/`.bat` and uses the full resolved path rather than
assuming an extension.

**Node version.** Playwright 1.49+ requires Node ≥ 20. The workspace `package.json` carries a `volta`
pin (`node: 22.19.0`, matching AdminPanel) so `node`/`npx` resolve correctly inside that folder even
when the machine's default toolchain is older — without it, Volta falls back to its global default
(Node 14 on this machine) and the install/run fails with an unsupported-engine error.

**Per-environment install.** `node_modules` is gitignored and is copied neither to the build output nor
to the publish folder, so every environment runs once in its script root:

```bash
npm install
npx playwright install chromium
```

The csproj excludes `node_modules`, `Generated` and `Artifacts` from the default item globs — otherwise
MSBuild enumerates tens of thousands of files on every build.

## 11. Known Gaps

- **Quiz-generated selectors are only partly verified.** The confirmed-correct ones (from a real
  recording against the app) are `quiz-attempt-btn-{quizId}`, `choice-answer-item-{answerId}`,
  `next-question-btn-{questionId}`, `submit-quiz-btn-{lastQuestionId}`, `submit-confirm-submit-btn`.
  Two things the generator emits are **not** confirmed:
  - **Login steps.** The generator emits `login-username-input` / `login-password-input` /
    `login-submit-btn`. The real app instead exposes `login-form-login-link` on the home page and then
    role-based fields (`getByRole('textbox', { name: 'Username or email' })`, `… 'Password'`,
    `getByRole('button', { name: 'Sign In' })`). Role names are locale-dependent, so the fix is either
    to add stable `data-testid`s to the login form or to accept locale coupling — a decision, not a
    typo. **Quiz-based tests will fail at login until this is settled.**
  - **Quiz entry URL.** The generator navigates `${baseUrl}/quiz/{id}` directly; the recording instead
    reaches the quiz through menu navigation and `quiz-title-link-{quizId}`. The direct URL is
    unverified.
- **Assertions are speculative.** `quiz-result-score` and `quiz-result-wrong-count` are assumed; they
  have not been checked against the results page.
- **Artifacts are listed, not served.** Paths are collected and shown in the console modal, but there is
  no endpoint streaming the PNG/WebM, so no inline gallery or video replay. Files are on disk under
  `Artifacts/{resultId}/`.
- **No retention sweep.** Old `TestingResult` rows, generated specs and artifacts accumulate forever.
- **No concurrency cap across runs.** `playwright.config.ts` sets `workers: 1` within a run, but nothing
  limits how many Hangfire runs execute at once.
- **Retries are not classified.** `RetryCount` is passed to `--retries`, which retries every failure;
  the design's "only auto-retry on transient/timeout errors" is not implemented.
- **No quiz-lookup caching** during script generation.
- **Not implemented:** `UploadPredefinedScript`, `PlaywrightTemplate` CRUD, SignalR, `TestExecutionPage`
  (a modal is used instead), export to PDF/JSON, comparison with previous runs.

## 12. Deviations From the Original Design

### 12.1 Data model collapsed from five entities to two

`PredefinedTest` and `DynamicQuizTest` became nullable columns on `AutomationTest`. The three test types
share most configuration (base URL, headless, timeout, retries, credentials) and differ in two or three
fields; separate tables meant a join and a polymorphic load on every list query for no gain. Switching a
test's type now clears the other types' columns so stale config cannot run.

`PlaywrightTemplate` became files on disk (§3.3).

Renames: `TestName`→`Name`, `Enabled`→`IsActive`, `TestExecutionLog`→`TestingResult` (matching the
scaffolded `TestingResult.cs` and `FetchTestingResults`), `TestScenario`→`QuizAnswerStrategy` with
`AnswerAll`/`RandomAnswer`/`SpecificAnswers` → `AllCorrect`/`Random`/`Specific`.

Dropped: the `Metadata` JSON column on both entities — speculative extensibility with no caller.

Added to the status enum: **`Error`**, for runs that never reached a verdict (script generation threw,
Node missing, workspace not installed). Collapsing those into `Failed` would have made a broken
environment look like a failing product. `Success`→`Passed` and `Timeout`→`TimedOut` for consistency
with Playwright's own vocabulary.

### 12.2 Execution is queued, not synchronous

The design implied the app service runs the script. A quiz run takes minutes, so it is a Hangfire job
(`AutomationTestRunJob`); the endpoint returns a `Pending` row immediately. This also gives scheduling
(`ScheduledAt` → `ExecuteScheduledAsync`) for free.

Consequence: `StopTest` cannot just kill a process it owns. It sets `CancellationRequested`; a `Pending`
run is cancelled and closed out inline, while a `Running` run is left to the job, which polls the flag
every 3s, kills the process tree and writes the real outcome.

### 12.3 Polling replaced SignalR

See §8. Driven by the scaffold (no hub, no socket hook) and by durability.

### 12.4 Credentials travel through the environment

The design said "mask secrets in stored scripts and logs". Instead the generated script reads
`process.env.PW_TEST_USER` / `PW_TEST_PASSWORD`, so no secret ever enters the script text and no masking
pass is needed. The stored password is `SimpleStringCipher`-encrypted and never returned to the client —
`AutomationTestDto` exposes only `HasTestPassword`.

### 12.5 Frontend consolidated

`TestTypeSelector`, `PredefinedTestForm` and `QuizTestForm` became tabs and a conditional body inside
`CreateEditAutomationTestModal`; `TestExecutionPage`, `TestResultsViewer` and `ScreenshotGallery` became
`ExecutionConsoleModal`. Driven by the scaffolded page, which drives everything from one page with a
modal. `ScreenshotGallery` is also blocked on there being no artifact-serving endpoint (§11).

### 12.6 Script root resolves from the content root

Originally `App_Data/PlaywrightScripts` relative to the binary. That puts `node_modules` under `bin`,
where a clean wipes it. It now comes from `IAppFolders.PlaywrightScriptsFolder`, set from the content
root alongside the existing `WebLogsFolder`, so dev uses the project folder and publish uses the publish
folder. Both `Web.Mvc` and `Web.Host` carry a workspace.
