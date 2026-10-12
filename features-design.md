# Playwright Automation Testing — Design Doc

Integration of Playwright-driven E2E testing into the React Admin Panel + ABP backend, supporting predefined scripts and dynamic quiz-based test generation.

## 1. Goals

1. Run predefined Playwright scripts from the admin panel and show results.
2. Dynamically generate a Playwright script from Quiz/Question repository data (turn quiz data into JSON, inject into a skeleton template, execute).
3. Support headless or headed (visible Chromium) execution, selectable per run.

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Admin Panel (Frontend)                 │
│  AutomationTestControlPage.tsx                                  │
│   ├─ Test List View                                              │
│   ├─ Create/Edit Modal                                           │
│   ├─ Test Execution Console                                     │
│   └─ Real-time Results Display                                  │
└───────────────────────────┬───────────────────────────────────────┘
                            │ HTTP (ABP dynamic API) + SignalR
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│            ABP Backend (AutomationTestingAppService)            │
│  Request Handler                                                 │
│   ├─ CreateAutomationTest                                        │
│   ├─ ExecutePredefinedTest                                       │
│   ├─ ExecuteDynamicQuizTest                                       │
│   ├─ GenerateQuizTestScript (preview only)                       │
│   ├─ FetchTestingResults                                          │
│   └─ StopTest                                                    │
│                          ▼                                       │
│  Test Generation Engine                                          │
│   ├─ Predefined Test Loader                                      │
│   ├─ Quiz → Playwright Script Generator                          │
│   └─ Template Engine (skeleton files w/ placeholders)            │
│                          ▼                                       │
│  Repositories                                                     │
│   ├─ AutomationTestRepository                                    │
│   ├─ QuizRepository / QuestionRepository / AnswerRepository     │
│   └─ TestExecutionLogRepository                                  │
│                          ▼                                       │
│  Playwright Executor Service                                     │
│   ├─ Script Generator                                            │
│   ├─ Headless/Headed Mode Manager                                │
│   ├─ Real-time Output Streamer (stdout/stderr → SignalR)        │
│   └─ Error Handler & Retry Logic                                 │
└────────────┬────────────────────────────────┬─────────────────────┘
             │                                │
             ▼                                ▼
    ┌──────────────────┐         ┌──────────────────────────┐
    │  Database         │         │  Playwright Runtime       │
    │   ├─ Tests         │         │   ├─ Browser Instances    │
    │   ├─ Executions    │         │   ├─ Script Execution     │
    │   ├─ Logs          │         │   └─ Screenshot/Video     │
    │   └─ Results       │         │      Capture              │
    └──────────────────┘         └──────────────────────────┘
```

## 3. Data Models / Entities

### 3.1 `AutomationTest` (main test definition)

| Field | Type | Notes |
|---|---|---|
| Id | int | |
| TestName | string | |
| Description | string | |
| TestType | enum | `Predefined`, `QuizBased`, `Custom` |
| Enabled | bool | |
| CreatorUserId | long | |
| CreationTime | DateTime | |
| LastModificationTime | DateTime? | |
| Tags | List\<string\> | |
| Metadata | JSON | extensibility |

### 3.2 `PredefinedTest` (pre-recorded script tests)

| Field | Type | Notes |
|---|---|---|
| Id | int | |
| AutomationTestId | FK | |
| ScriptPath | string | stored `.spec.ts` location |
| PlaywrightConfig | JSON | baseUrl, timeout, etc. |
| Headless | bool | |
| ExpectedOutputPattern | string/regex | optional pass/fail check |

### 3.3 `DynamicQuizTest` (quiz-based dynamic tests)

| Field | Type | Notes |
|---|---|---|
| Id | int | |
| AutomationTestId | FK | |
| QuizId | FK → Quiz | |
| TestUsername / TestPasswordEncrypted | string | test account credentials |
| TestScenario | enum | `AnswerAll`, `RandomAnswer`, `SpecificAnswers` |
| AnswerMapping | JSON | `QuestionId → AnswerId` (used when `SpecificAnswers`) |
| SkipQuestions | List\<int\> | |
| Headless | bool | |
| ValidationRules | JSON | e.g. expected score, time limit |
| TemplateId | FK → PlaywrightTemplate | |

### 3.4 `TestExecutionLog`

| Field | Type | Notes |
|---|---|---|
| Id | int | |
| AutomationTestId | FK | |
| ExecutionStartTime | DateTime | |
| ExecutionEndTime | DateTime? | |
| Status | enum | `Pending`, `Running`, `Success`, `Failed`, `Timeout`, `Cancelled` |
| ErrorMessage | string | |
| Stdout / Stderr | text | streamed output, persisted on completion |
| Screenshots | List\<string\> | file paths |
| VideoPath | string | |
| Duration | TimeSpan | |
| ExecutedByUserId | long | |
| Metadata | JSON | |

### 3.5 `PlaywrightTemplate` (reusable skeleton files)

| Field | Type | Notes |
|---|---|---|
| Id | int | |
| TemplateName | string | |
| TemplateContent | text | Playwright script with `{{PLACEHOLDER}}` tokens |
| Placeholders | JSON | documents expected placeholder keys |
| Description | string | |
| CreationTime | DateTime | |
| IsPublic | bool | |

## 4. Frontend Design (React Admin Panel)

### 4.1 Screens

- **Test Management Dashboard** — list tests, filter by type/status/creator, quick stats (total tests, recent executions, success rate), actions: Create / Edit / Run / View Results / Delete.
- **Create/Edit Test Modal** (tabbed):
  - *Basic Info*: name, description, tags, enabled toggle.
  - *Test Type*: Predefined Script / Quiz-Based Dynamic / Custom.
  - *Predefined config*: upload or select `.spec.ts`, base URL, timeout, headless toggle, validation pattern.
  - *Quiz-based config*: select quiz, test user, answer strategy (All Correct / Random / Custom mapping), question subset selection, headless toggle, template selection, validation rules (expected score, time limit).
  - *Advanced*: retry count, timeout, screenshot/video capture toggle, tags.
- **Test Execution Console** — real-time log stream, optional live screenshot/video, current step indicator, progress bar, Stop/Pause controls.
- **Results & Reports** — status badge, duration/timestamp/executor, full log viewer, screenshot gallery, video replay, comparison with previous runs, export (PDF/JSON).

### 4.2 Frontend file layout

```
AdminPanel/src/features/testing/
├─ pages/
│  ├─ AutomationTestControlPage.tsx
│  └─ TestExecutionPage.tsx
├─ components/
│  ├─ CreateEditAutomationTestModal.tsx
│  ├─ TestTypeSelector.tsx
│  ├─ PredefinedTestForm.tsx
│  ├─ QuizTestForm.tsx
│  ├─ ExecutionConsole.tsx
│  ├─ TestResultsViewer.tsx
│  ├─ ScreenshotGallery.tsx
│  └─ TestList.tsx
├─ hooks/
│  ├─ useFetchTestingResults.ts
│  ├─ useExecuteTest.ts
│  ├─ useTestExecution.ts        # SignalR/WebSocket listener
│  └─ useGenerateScript.ts
├─ services/
│  ├─ automationTestService.ts   # API calls
│  └─ executionWebSocketService.ts
├─ types/
│  ├─ AutomationTest.ts
│  └─ TestExecution.ts
└─ utils/
   ├─ playwrightScriptFormatter.ts
   └─ testResultsParser.ts
```

## 5. Backend Design

### 5.1 AppService surface (`AutomationTestingAppService`)

| Method | Returns | Purpose |
|---|---|---|
| `CreateAutomationTest(CreateAutomationTestInput)` | `AutomationTestDto` | Persist test config |
| `UpdateAutomationTest(UpdateAutomationTestInput)` | `AutomationTestDto` | Edit config |
| `ExecutePredefinedTest(ExecuteTestInput)` | execution id | Run stored script |
| `ExecuteDynamicQuizTest(ExecuteQuizTestInput)` | execution id | Build + run quiz script |
| `GenerateQuizTestScript(GenerateScriptInput)` | string (script preview) | Preview only, no execution |
| `FetchTestingResults(FetchTestingResultsInput)` | `FetchTestingResultsOutput` | Paginated execution logs |
| `GetExecutionLog(executionId)` | `TestExecutionLogDto` | Full log detail |
| `StopTest(executionId)` | void | Kill running process |
| `UploadPredefinedScript(file, metadata)` | `PredefinedTestDto` | Store `.spec.ts` upload |

### 5.2 Domain services

- **`PlaywrightScriptGeneratorService`** — `GenerateFromTemplate(template, placeholders) → string`. Replaces `{{PLACEHOLDER}}` tokens in a skeleton with real values/steps.
- **`QuizTestScriptBuilder`** — `BuildFromQuiz(quiz, questions, answers, testUser) → PlaywrightScript`. Converts quiz/question/answer entities into ordered Playwright actions (login → navigate → per-question answer/next → submit), mapping to existing `data-testid` attributes.
- **`PlaywrightExecutorService`** — `ExecuteScript(script, config, onProgress, onComplete)`. Spawns a child process (`npx playwright test ...`), streams stdout/stderr, enforces timeout, persists `TestExecutionLog`, captures screenshots/video if configured.

### 5.3 Repositories

- `IAutomationTestRepository`
- `IPredefinedTestRepository`
- `IDynamicQuizTestRepository`
- `ITestExecutionLogRepository`
- `IPlaywrightTemplateRepository`
- `IQuizRepository` / `IQuestionRepository` (read-only access to existing quiz data)

### 5.4 Backend file layout

```
CTH.QuizSystem.Application/
└─ AutomationTesting/
   ├─ AutomationTestingAppService.cs
   ├─ Dto/
   │  ├─ CreateAutomationTestInput.cs
   │  ├─ ExecuteTestInput.cs
   │  ├─ ExecuteQuizTestInput.cs
   │  ├─ AutomationTestDto.cs
   │  ├─ TestExecutionLogDto.cs
   │  └─ GenerateScriptInput.cs
   └─ Services/
      ├─ PlaywrightScriptGeneratorService.cs
      ├─ QuizTestScriptBuilder.cs
      ├─ PlaywrightExecutorService.cs
      └─ IPlaywrightExecutor.cs

CTH.QuizSystem.Core/
└─ AutomationTesting/
   ├─ Entities/
   │  ├─ AutomationTest.cs
   │  ├─ PredefinedTest.cs
   │  ├─ DynamicQuizTest.cs
   │  ├─ TestExecutionLog.cs
   │  └─ PlaywrightTemplate.cs
   └─ Domain/
      └─ IPlaywrightExecutor.cs

CTH.QuizSystem.EntityFrameworkCore/
└─ AutomationTesting/
   └─ AutomationTestingDbContext mappings

App_Data/PlaywrightScripts/
├─ Predefined/{test-id}.spec.ts
├─ Generated/{execution-id}-{timestamp}.spec.ts
├─ Templates/
│  ├─ quiz-template.spec.ts
│  └─ predefined-template.spec.ts
├─ Screenshots/{execution-id}/...
└─ Videos/{execution-id}.webm
```

## 6. Dynamic Quiz Test — Data Flow

1. User selects **Quiz-Based Test**, picks a Quiz from a searchable dropdown.
2. Backend loads `Quiz` + `QuizQuestions` → `Question` → `Answers` (and `MatchAnswers`/`QuestionDropZones` where relevant).
3. `QuizTestScriptBuilder`:
   - Builds login steps using the configured test user.
   - Builds navigation steps to the quiz.
   - For each question (respecting `SkipQuestions` and question order):
     - Resolves the answer to select per `TestScenario` (correct / random / explicit mapping).
     - Emits `page.getByTestId('choice-answer-item-{AnswerId}').click()` (or the matching testid pattern for the question type).
     - Emits the "next question" step using the question's testid pattern.
   - Emits submit + confirm-submit steps.
4. `PlaywrightScriptGeneratorService` loads `quiz-template.spec.ts` and injects the generated steps (and assertions from `ValidationRules`) into placeholders.
5. `PlaywrightExecutorService` runs `npx playwright test <generated-script> [--headed]`, streaming stdout/stderr line-by-line over SignalR.
6. Frontend `ExecutionConsole` renders the live log; on completion, results (status, duration, screenshots, video) are shown in `TestResultsViewer` and persisted to `TestExecutionLog`.

## 7. Playwright Skeleton Template (example)

```typescript
// quiz-template.spec.ts
import { test, expect } from '@playwright/test';

test('Quiz Test - {{QUIZ_NAME}}', async ({ page }) => {
  {{LOGIN_STEPS}}

  {{QUIZ_STEPS}}

  {{ASSERTIONS}}
});
```

`{{QUIZ_STEPS}}` is replaced with generated per-question actions, e.g.:

```typescript
await page.getByTestId('quiz-attempt-btn-{{QUIZ_ID}}').click();
await page.getByTestId('choice-answer-item-2313971').click();
await page.getByTestId('next-question-btn-1195304').click();
// ... one block per question
await page.getByTestId('submit-quiz-btn-1195306').click();
await page.getByTestId('submit-confirm-submit-btn').click();
```

## 8. Real-Time Communication

- **SignalR** (recommended, fits ABP/.NET stack): `TestExecutionHub` pushes `onLogReceived`, `onProgressUpdate`, `onExecutionComplete` events to subscribed clients per `executionId`.
- Alternative: gRPC server-streaming, or plain WebSocket, if SignalR isn't desired.

## 9. Headless vs. Headed Execution

- `Headless` flag stored per test/execution request, passed through to the Playwright CLI invocation (`--headed` when `false`) or into the generated `playwright.config.ts` (`use: { headless }`).
- Headed mode is intended for local/debug runs; the executor should run on a host where a display/Xvfb is available, or restrict headed mode to local dev environments.

## 10. Key Considerations

- **Security**
  - Encrypt/never log test account passwords; mask secrets in stored scripts and logs.
  - Validate uploaded scripts (`.spec.ts` only, size limits, path traversal checks on `ScriptPath`).
  - Authorization: only test owners/admins can execute or view others' tests; enforce ABP permission checks per endpoint.
  - Run Playwright execution in a restricted/sandboxed process (least-privilege OS user, no shell injection — build the process args array, never concatenate into a shell string).
- **Reliability**
  - Catch and classify Playwright errors (timeout vs. element-not-found vs. navigation failure); only auto-retry on transient/timeout errors.
  - Enforce a hard execution timeout and kill orphaned browser/node processes.
- **Scalability**
  - Queue executions via a background job runner (Hangfire/Quartz, whichever the project already uses) and cap concurrent Playwright processes.
  - Cache Quiz/Question lookups briefly (short TTL) to avoid redundant repository hits during script generation.
- **Performance**
  - Lazy-load screenshots/video (store paths, serve on demand via a dedicated endpoint).
  - Paginate test list and execution log queries.

## 11. Summary

- Predefined test execution with quick setup and stored scripts.
- Dynamic quiz-based testing driven by existing Quiz/Question/Answer repositories.
- Real-time execution monitoring via SignalR.
- Headless and headed execution modes, selectable per run.
- Centralized logging and result storage (`TestExecutionLog`) with screenshots/video for diagnostics.
