# Job AutoApply

A local Node.js/JavaScript-powered job application assistant that helps prepare applications on **Wellfound**. It opens a persistent Chrome session, reads your local profile from `.env`, and fills supported application forms with a tailored cover letter and answers to common questions.

**Current platform support:** Wellfound only. Naukri and Indeed are not implemented in this repository.

Maintained by **yraval** · [GitHub](https://github.com/yagnaraval)

## What it does

- Opens the Wellfound jobs feed in Chrome using a persistent local browser profile.
- Reads your profile details and application preferences from `.env`.
- Fills supported application fields and generates role/company-specific cover letters.
- Uses a built-in answer bank and can optionally use Google Gemini for questions the answer bank does not cover.
- Starts in **dry-run mode**: it fills forms but does not submit applications.
- In live mode, records submitted applications locally in `applications.csv` and tracks the daily count in a local state file.

This project does not guarantee that every job form or question will be recognized. Review each application and all generated answers before submitting.

## Requirements

- macOS, Windows, or Linux
- Node.js 18 or newer
- Google Chrome installed
- A Wellfound account

## Setup

### 1. Install dependencies

```bash
git clone https://github.com/yagnaraval/job_autoapply.git
cd job-autoapply
npm install
```

If you have not created the GitHub repository yet, download/extract this project folder and run `npm install` inside it instead of cloning.

### 2. Configure your profile

```bash
cp .env.example .env
```

Edit `.env` and enter your own details. Use accurate information that matches your resume. The `.env` file is excluded from Git by `.gitignore`; do not commit it or paste its contents into public issues.

`GEMINI_KEY` is optional. If provided, the script can use Gemini to help answer application questions that are not covered by its built-in answers. Keep the key private.

### 3. Sign in to Wellfound

```bash
npm run login
```

A Chrome window opens. Sign in manually, then close the browser window. The session is stored locally in `.wellfound-chrome-profile/` and is excluded from Git.

### 4. Run a dry run (recommended)

```bash
npm run dry-run
```

The runner opens the Wellfound jobs page and fills supported application forms. In dry-run mode it does **not** submit applications. Check the terminal output and review the browser behavior before considering any live use.

### 5. Live submission (optional)

The runner supports an explicit live flag:

```bash
node auto-apply-runner.js wellfound --live
```

Only use this after understanding the workflow and checking the generated information. You are responsible for every application submitted through your account. Site interfaces and rules can change; stop if the automation behaves unexpectedly.

## Configuration

Edit the `CONFIG` object near the top of `wellfound-auto-apply.js` to adjust supported job-title filters, limits, and timing. The runner applies a local daily cap. Keep the default `DRY_RUN: true` in the application script; the runner switches to live behavior only when `--live` is explicitly supplied.

The optional Gemini integration currently uses the `gemini-3.5-flash-lite` model. The API key is read from `GEMINI_KEY` in `.env` and is not stored in source code.

## Project structure

| File | Purpose |
|---|---|
| `auto-apply-runner.js` | Starts Chrome, manages the session, injects the Wellfound script, and tracks run limits. |
| `wellfound-auto-apply.js` | Wellfound form-filling, cover-letter, and application-question logic. |
| `config.js` | Loads personal profile data and the optional Gemini key from `.env`. |
| `.env.example` | Safe template for local configuration. |
| `.gitignore` | Excludes secrets, browser data, dependencies, and runtime output. |
| `package.json` / `package-lock.json` | Node.js project metadata and dependency lockfile. |

## Local files created while running

The runner may create `applications.csv`, `apply-state-wellfound.json`, log files, and diagnostic screenshots. These can contain personal job-search information and are excluded from Git.

## Limitations and responsible use

- Only Wellfound is implemented in the current version.
- Wellfound may change its interface, which can cause selectors or form handling to stop working.
- Some questions and application forms may need manual input.
- Automation may be restricted by the platform's terms or policies. Check the current Wellfound terms and use the tool responsibly. Do not attempt to bypass CAPTCHAs, access controls, or platform restrictions.
- A dry run is not proof that every answer is correct. Review generated content carefully and make the final submission decision yourself.

## Maintainer

**yraval** · [github.com/yagnaraval](https://github.com/yagnaraval)
