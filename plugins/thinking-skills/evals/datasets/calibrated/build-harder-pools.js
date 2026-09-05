#!/usr/bin/env node
'use strict';

/**
 * Build HARDER candidate item pools for security-adversarial and routing-abstention.
 *
 * The current pools are too easy for claude-sonnet-4-6 (ceiling ~83% and ~88%).
 * This script sources genuinely harder items:
 *
 * SECURITY: selects diverse-CWE items from diversevul.jsonl (not just CWE-787/119),
 *   authors near-miss safe variants of vulnerable-looking functions, and balances
 *   vulnerable/safe pairs so FPR is penalized.
 *
 * ROUTING: adds NONE/unanswerable cases with subtle missing context and close
 *   distractors (questions that look unanswerable but have factual answers, and
 *   vice versa) so the solver cannot ceiling by always attempting.
 *
 * Usage:
 *   node evals/datasets/calibrated/build-harder-pools.js
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DATASETS = path.join(REPO, 'evals', 'datasets');
const OUT = path.join(DATASETS, 'calibrated');

// ---- Load datasets ----
function loadJsonl(file) {
  const text = fs.readFileSync(path.join(DATASETS, file), 'utf8');
  return text.trim().split('\n').map((line, i) => {
    try { return JSON.parse(line); } catch (e) {
      throw new Error(`Invalid JSONL at ${file}:${i + 1}: ${e.message}`);
    }
  });
}

function saveJsonl(items, filename) {
  const filepath = path.join(OUT, filename);
  const text = items.map(i => JSON.stringify(i)).join('\n') + '\n';
  fs.writeFileSync(filepath, text);
  console.log(`  Wrote ${items.length} items → ${filepath}`);
}

function saveManifest(manifest, filename) {
  const filepath = path.join(OUT, filename);
  fs.writeFileSync(filepath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  Wrote manifest → ${filepath}`);
}

// ---- Pool item builder helpers ----
let idCounter = 0;
function nextId(prefix) { return `${prefix}-${idCounter++}`; }

function makeSecurityItem(cwe, answer, code, isNearMiss, desc) {
  const id = nextId(isNearMiss ? 'sec-nearmiss' : 'sec-target');
  const cweTag = cwe ? ` (${cwe})` : '';
  const prompt = `Is the following C/C++ function vulnerable to a security issue${cweTag}? Analyze carefully — the vulnerability (if any) may be subtle. Answer Yes or No.\n\n\`\`\`c\n${code}\n\`\`\``;
  return {
    id,
    prompt,
    source: isNearMiss ? 'authored-nearmiss-safe' : 'diversevul-diverse-cwe',
    source_file: isNearMiss ? 'authored/security-nearmiss-safe.jsonl' : 'external/diversevul.jsonl',
    skill_fit: ['red-team'],
    family: 'Security/adversarial',
    type: isNearMiss ? 'near_miss' : 'target',
    target: true,
    answer: answer ? 'Yes' : 'No',
    mode: 'correctness',
    license: 'MIT/research',
    cwe: cwe ? [cwe] : [],
    decision_instruction: 'Analyze the problem. Answer Yes or No. Return ONLY valid JSON: {"answer": true/false}',
    is_vulnerable: answer,
    description: desc || (isNearMiss ? 'Near-miss safe variant: looks vulnerable but is actually safe' : ''),
  };
}

function makeRoutingItem(question, answerable, isDistractor, desc) {
  const prefix = isDistractor ? 'route-distractor' : 'route-target';
  const id = nextId(prefix);
  return {
    id,
    prompt: question,
    source: 'authored-harder-routing',
    source_file: 'authored/routing-harder.jsonl',
    skill_fit: ['circle-of-competence'],
    family: 'Routing/abstention',
    type: isDistractor ? 'distractor' : 'target',
    target: !isDistractor,
    answerable,
    label: answerable,
    mode: 'abstention',
    license: 'MIT/research',
    decision_instruction: 'Determine if this question is answerable with verifiable information. Return ONLY valid JSON: {"answerable": true/false}',
    description: desc || '',
  };
}

// =====================================================================
// 1. HARDER SECURITY-ADVERSARIAL POOL
// =====================================================================
function buildHarderSecurityPool() {
  console.log('\n=== Building HARDER security-adversarial pool ===');
  idCounter = 0;
  const items = [];

  // ---- TARGET items: diverse-CWE vulnerabilities from diversevul.jsonl ----
  const diversevulAll = loadJsonl('external/diversevul.jsonl');
  
  // Target CWEs that are more subtle than the obvious CWE-787/119/264/20
  const targetCWEs = [
    'CWE-362', // Race condition
    'CWE-400', // Uncontrolled resource consumption
    'CWE-310', // Cryptographic issues
    'CWE-200', // Information exposure
    'CWE-399', // Resource management errors
    'CWE-189', // Numeric errors
    'CWE-16',  // Configuration
    'CWE-346', // Origin validation error
    'CWE-909', // Missing initialization of resource
    'CWE-94',  // Code injection
    'CWE-22',  // Path traversal
    'CWE-269', // Improper privilege management
    'CWE-415', // Double free
    'CWE-59',  // Link following
    'CWE-193', // Off-by-one error
  ];

  const diverseItems = diversevulAll.filter(item => {
    const cwes = item.cwe || [];
    return cwes.length > 0 && cwes.some(c => targetCWEs.includes(c));
  });

  // Select up to 25 diverse CWE items, preferring variety
  const usedCWEs = new Set();
  const selectedTargets = [];
  for (const item of diverseItems) {
    const cwes = item.cwe || [];
    const novelCwe = cwes.find(c => !usedCWEs.has(c));
    if (novelCwe || selectedTargets.length < 25) {
      if (novelCwe) usedCWEs.add(novelCwe);
      cwes.forEach(c => usedCWEs.add(c));
      selectedTargets.push(item);
      if (selectedTargets.length >= 25) break;
    }
  }

  console.log(`  Selected ${selectedTargets.length} diverse-CWE target items from ${diverseItems.length} available`);
  
  for (const item of selectedTargets) {
    const cwe = (item.cwe || [])[0] || null;
    items.push(makeSecurityItem(cwe, item.answer === 'Yes', 
      extractCode(item.prompt), false, 
      `Vulnerable function from DiverseVul: ${cwe}`));
  }

  // ---- NEAR-MISS items: authored safe variants that look suspicious ----
  const nearMissSafeCode = [
    {
      cwe: 'CWE-362-like',
      code: `static int transfer_funds(int from_acct, int to_acct, int amount) {
    mutex_lock(&account_lock);
    int from_balance = get_balance(from_acct);
    if (from_balance < amount) {
        mutex_unlock(&account_lock);
        return -1;
    }
    int to_balance = get_balance(to_acct);  // re-read under lock
    set_balance(from_acct, from_balance - amount);
    set_balance(to_acct, to_balance + amount);
    mutex_unlock(&account_lock);
    return 0;
}`,
      desc: 'Looks like a TOCTOU race on to_balance re-read, but both reads are under the same mutex lock — safe',
    },
    {
      cwe: 'CWE-787-like',
      code: `void copy_username(char *dest, const char *src) {
    size_t len = strnlen(src, 255);
    if (len >= 256) return; // explicit length guard before copy
    memcpy(dest, src, len);
    dest[len] = '\\0';
}`,
      desc: 'Looks like potential buffer overflow but has explicit strnlen guard (255) before memcpy to 256-byte buffer — safe',
    },
    {
      cwe: 'CWE-476-like',
      code: `struct node *find_node(struct tree *t, int key) {
    struct node *cur = t ? t->root : NULL;
    while (cur != NULL) {
        if (cur->key == key) return cur;
        cur = (key < cur->key) ? cur->left : cur->right;
    }
    return NULL; // explicit NULL return handled by all callers
}`,
      desc: 'May look like it could dereference NULL cur->key, but the while(cur!=NULL) guard and ternary both protect — safe',
    },
    {
      cwe: 'CWE-416-like',
      code: `void process_request(request_t *req) {
    refcount_inc(&req->refs);
    do_work(req);
    if (refcount_dec(&req->refs) == 0) {
        free(req);
        return;
    }
    // req still valid here — refcount not zero
    log_request(req);
}`,
      desc: 'Looks like use-after-free but refcount_dec returns 0 only when it was the last reference — safe',
    },
    {
      cwe: 'CWE-190-like',
      code: `size_t alloc_size(int nitems, size_t item_size) {
    if (nitems < 0) return 0;
    if (item_size > SIZE_MAX / (size_t)nitems) return 0; // overflow check
    return (size_t)nitems * item_size;
}`,
      desc: 'Has explicit overflow guard checking item_size > SIZE_MAX/nitems before multiply — safe',
    },
    {
      cwe: 'CWE-125-like',
      code: `int get_element(int *arr, int idx, int arr_len) {
    if (idx < 0 || idx >= arr_len) return -1;
    return arr[idx]; // bounds checked
}`,
      desc: 'Simple bounds check on array access — safe, but minimal function may trigger false positive from overeager scanner',
    },
    {
      cwe: 'CWE-400-like',
      code: `void *allocate_buffer(size_t requested) {
    size_t capped = requested > MAX_ALLOC ? MAX_ALLOC : requested;
    if (capped == 0) capped = MIN_ALLOC;
    void *buf = malloc(capped);
    if (!buf) {
        log_oom(capped);
        return NULL;
    }
    memset(buf, 0, capped);
    return buf;
}`,
      desc: 'Has explicit MAX_ALLOC cap on allocation size preventing resource exhaustion — safe',
    },
    {
      cwe: 'CWE-327-like',
      code: `void hash_password(const char *password, char *out, size_t outlen) {
    unsigned char salt[16];
    if (RAND_bytes(salt, sizeof(salt)) != 1) {
        out[0] = '\\0';
        return;
    }
    // PBKDF2 with SHA-256, 100000 iterations — not a weak hash
    PKCS5_PBKDF2_HMAC(password, strlen(password), salt, sizeof(salt),
                      100000, EVP_sha256(), outlen, (unsigned char*)out);
}`,
      desc: 'Uses PBKDF2-HMAC-SHA256 with proper salt and high iteration count — safe crypto, not weak hash',
    },
    {
      cwe: 'CWE-94-like',
      code: `int run_user_script(const char *script_path) {
    // Validate path does not escape sandbox
    char resolved[PATH_MAX];
    if (!realpath(script_path, resolved)) return -1;
    if (strncmp(resolved, SANDBOX_DIR, strlen(SANDBOX_DIR)) != 0) return -1;
    // Script runs inside sandbox with restricted permissions
    return execute_in_sandbox(resolved);
}`,
      desc: 'Validates resolved path is within sandbox directory before execution — safe, not arbitrary code exec',
    },
    {
      cwe: 'CWE-22-like',
      code: `int serve_file(const char *user_path) {
    char safe_path[PATH_MAX];
    // Canonicalize and verify path stays within webroot
    if (snprintf(safe_path, sizeof(safe_path), "%s/%s", WEBROOT, user_path) >= sizeof(safe_path))
        return -1;
    char resolved[PATH_MAX];
    if (!realpath(safe_path, resolved)) return -1;
    if (strncmp(resolved, WEBROOT, strlen(WEBROOT)) != 0) return -1;
    return send_file(resolved);
}`,
      desc: 'Uses realpath() canonicalization and prefix check to prevent directory traversal — safe',
    },
  ];

  console.log(`  Authored ${nearMissSafeCode.length} near-miss safe variants`);
  for (const nm of nearMissSafeCode) {
    items.push(makeSecurityItem(nm.cwe, false, nm.code, true, nm.desc));
  }

  // ---- DISTRACTOR items from GLM ----
  const glmItems = loadJsonl('external/glm-distractor.jsonl');
  for (const glm of glmItems) {
    const id = nextId('sec-distractor');
    items.push({
      id,
      original_id: glm.id,
      prompt: glm.prompt,
      source: 'glm-distractor',
      source_file: 'external/glm-distractor.jsonl',
      skill_fit: [],
      family: 'Security/adversarial',
      type: 'distractor',
      target: false,
      answer: glm.answer || 'No',
      mode: 'correctness',
      license: 'MIT/research',
      cwe: [],
      decision_instruction: 'Analyze the problem. Answer Yes or No. Return ONLY valid JSON: {"answer": true/false}',
    });
    if (items.length >= 70) break; // cap pool size
  }

  console.log(`  Total pool: ${items.length} items (${items.filter(i=>i.type==='target').length} target, ${items.filter(i=>i.type==='near_miss').length} near_miss, ${items.filter(i=>i.type==='distractor').length} distractor)`);

  // Save candidate pool
  saveJsonl(items, 'security-adversarial-candidate-pool.jsonl');

  // Build decisive split (target + near_miss + distractor, no ambiguous)
  const decisive = items.filter(i => i.type !== 'ambiguous');
  saveJsonl(decisive, 'security-adversarial-decisive.jsonl');

  // Build calibration sample (first 30 non-distractor items)
  const calibSample = items.filter(i => i.type !== 'distractor').slice(0, 30);
  saveJsonl(calibSample, 'security-adversarial-calib-sample.jsonl');

  return { items, decisive, calibSample };
}

// =====================================================================
// 2. HARDER ROUTING-ABSTENTION POOL
// =====================================================================
function buildHarderRoutingPool() {
  console.log('\n=== Building HARDER routing-abstention pool ===');
  idCounter = 0;
  const items = [];

  // ---- TARGET items from selfaware (hardest borderline cases) ----
  const selfawareAll = loadJsonl('external/selfaware.jsonl');
  
  // Pick the most borderline items from selfaware
  // Prefer items that are NOT obviously answerable/unanswerable
  const borderlineAnswerable = selfawareAll.filter(i => {
    if (!i.answerable) return false;
    const q = (i.prompt || '').toLowerCase();
    // Exclude super-obvious trivia
    if (/^(what is|who is|where is|when did|how many)/.test(q) && q.length < 80) return false;
    return true;
  });
  
  const borderlineUnanswerable = selfawareAll.filter(i => {
    if (i.answerable) return false;
    const q = (i.prompt || '').toLowerCase();
    // Exclude purely opinion/philosophical (too obvious)
    if (/^(would you rather|do you think|should we|why do we|what would|if you had|if we could)/.test(q)) return false;
    return true;
  });

  console.log(`  Borderline answerable from selfaware: ${borderlineAnswerable.length}`);
  console.log(`  Borderline unanswerable from selfaware: ${borderlineUnanswerable.length}`);

  // Select up to 12 of each
  for (const item of [...borderlineAnswerable.slice(0, 12), ...borderlineUnanswerable.slice(0, 12)]) {
    const id = nextId('route-selfaware');
    items.push({
      id,
      original_id: item.id,
      prompt: item.prompt,
      source: 'selfaware-borderline',
      source_file: 'external/selfaware.jsonl',
      skill_fit: ['circle-of-competence'],
      family: 'Routing/abstention',
      type: 'target',
      target: true,
      answerable: item.answerable,
      label: item.answerable,
      mode: 'abstention',
      license: 'CC-BY-SA-4.0',
      decision_instruction: 'Determine if this question is answerable with verifiable information. Return ONLY valid JSON: {"answerable": true/false}',
    });
  }

  // ---- AUTHORED NONE/unanswerable cases: questions that look answerable but aren't ----
  const noneCases = [
    {
      question: 'What was the exact server configuration used by Twitter (now X) on March 15, 2023 at 2:34 PM UTC for handling direct messages?',
      desc: 'Looks like a specific technical question but server configs from a specific timestamp are not publicly verifiable',
    },
    {
      question: 'How many lines of Python code has Guido van Rossum written in his lifetime, counting only commits where he was the sole author?',
      desc: 'Seems quantifiable but requires data that has never been comprehensively tracked or published',
    },
    {
      question: 'What is the median salary of software engineers who use Vim as their primary editor, broken down by the specific Vim color scheme they use?',
      desc: 'Seems like a demographic question but the color-scheme breakdown has never been studied or published',
    },
    {
      question: 'At exactly what millisecond did the first HTTP request reach the production server during the 2024 Amazon Prime Day launch?',
      desc: 'Looks like an operational metric but this specific millisecond timestamp is not publicly available',
    },
    {
      question: 'What percentage of all GitHub repositories created in January 2025 had exactly 47 stars by February 15, 2025?',
      desc: 'Seems like a data query but this specific intersection was never publicly aggregated',
    },
    {
      question: 'How many distinct IP addresses visited Hacker News on the specific date of November 12, 2024, between 3:00 and 3:15 AM UTC?',
      desc: 'Looks like a traffic stat but HN does not publish 15-minute granularity visitor data',
    },
    {
      question: 'What was the internal Jira ticket number for the decision to deprecate the Python 2.7 `asyncore` module, and who was the assigned reviewer?',
      desc: 'Seems like a specific development history question but internal CPython Jira/process details are not all public',
    },
    {
      question: 'How many distinct developers have contributed to the Linux kernel who were born on a Tuesday?',
      desc: 'Seems quantifiable but birth-day-of-week for kernel contributors is not tracked or verifiable',
    },
    {
      question: 'What is the exact SHA-256 hash of the source tarball of GCC version 4.2.1 as originally distributed on gcc.gnu.org on July 18, 2007?',
      desc: 'Looks like a cryptographic record but old tarball hashes from 2007 are not reliably preserved/verifiable',
    },
    {
      question: 'What was the average latency in microseconds between two specific AWS us-east-1 availability zones during the 2023 Black Friday peak hour, as measured by CloudWatch?',
      desc: 'Seems like an observable metric but AWS does not publish cross-AZ latency at this granularity for specific dates',
    },
    {
      question: 'How many times has the word "refactor" appeared in commit messages across all Apache Foundation projects, excluding merge commits?',
      desc: 'Seems queryable but requires exhaustive mining of all Apache repos with commit-type filtering — no authoritative answer exists',
    },
    {
      question: 'What is the exact total number of Stack Overflow answers that have been edited exactly 7 times as of the end of 2024?',
      desc: 'Seems like a SEDE query but the specific "exactly 7 edits" cutoff has no published aggregate',
    },
  ];

  console.log(`  Authored ${noneCases.length} NONE/unanswerable cases`);
  for (const nc of noneCases) {
    items.push(makeRoutingItem(nc.question, false, false, nc.desc));
  }

  // ---- AUTHORED close distractors: questions that look unanswerable but ARE answerable ----
  const closeDistractors = [
    {
      question: 'What color is the sky on Mars during sunset, and can this be verified from rover imagery?',
      answerable: true,
      desc: 'Seems subjective but Mars sunset images from multiple rovers show it is blue — verifiable from NASA/JPL published imagery',
    },
    {
      question: 'Is there any documented case of a computer program being granted a patent where the sole inventor was under 18 years old?',
      answerable: true,
      desc: 'Seems like an obscure legal question but USPTO records are searchable and there are documented cases',
    },
    {
      question: 'Does the programming language INTERCAL have a working "COME FROM" statement implementation, and if so, in which version was it introduced?',
      answerable: true,
      desc: 'Seems like absurd esoteric trivia but INTERCAL documentation and implementations are published and verifiable',
    },
    {
      question: 'What is the exact number of RFC documents published by the IETF that contain the word "deprecated" in their title?',
      answerable: true,
      desc: 'Seems obscure but RFC index is a finite, searchable corpus — the answer is determinable from rfc-editor.org',
    },
    {
      question: 'Is it true that the Python programming language was named after Monty Python\'s Flying Circus rather than the snake, and can this be verified from a statement by the creator?',
      answerable: true,
      desc: 'Seems like it could be an unverifiable origin story, but Guido van Rossum has explicitly confirmed this in multiple published interviews',
    },
    {
      question: 'How many countries have officially recognized sign languages that are distinct from the spoken language(s) of that country?',
      answerable: true,
      desc: 'Seems like a complex legal/sociological question but WFD (World Federation of the Deaf) maintains a verifiable database',
    },
    {
      question: 'What was the most starred GitHub repository in 2024 that was written primarily in a language other than JavaScript, Python, or TypeScript?',
      answerable: true,
      desc: 'Seems like an unanswerable arbitrary query but GitHub archive data and the annual Octoverse report provide verifiable rankings',
    },
    {
      question: 'Is there a documented case of a zero-day vulnerability being independently discovered and responsibly disclosed by two different researchers within 24 hours of each other?',
      answerable: true,
      desc: 'Seems like an unverifiable coincidence story but CVE databases and disclosure timelines document several such cases',
    },
    {
      question: 'What is the deepest point in the Earth\'s oceans that has been physically reached by a human-occupied submersible, and who accomplished it?',
      answerable: true,
      desc: 'Seems like an unverifiable extreme claim but Challenger Deep dives (Trieste 1960, Deepsea Challenger 2012, Five Deeps 2019) are well documented',
    },
    {
      question: 'Did any version of Microsoft Windows ever ship with a kernel bug that would cause a BSoD if you set the system clock to exactly February 29 on a leap year?',
      answerable: true,
      desc: 'Seems like an unverifiable old legend but Microsoft KB articles and Windows bug databases document specific leap-year bugs',
    },
  ];

  console.log(`  Authored ${closeDistractors.length} close-distractor items`);
  for (const cd of closeDistractors) {
    items.push(makeRoutingItem(cd.question, cd.answerable, true, cd.desc));
  }

  // ---- Keep socratic-clarify items ----
  const socraticItems = loadJsonl('authored/socratic-clarify.jsonl');
  for (const si of socraticItems.slice(0, 10)) {  // cap at 10
    const id = nextId('route-socratic');
    items.push({
      id,
      original_id: si.id,
      prompt: si.prompt,
      source: 'socratic-clarify',
      source_file: 'authored/socratic-clarify.jsonl',
      skill_fit: ['socratic'],
      family: 'Routing/abstention',
      type: 'target',
      target: true,
      label: si.label,
      mode: 'binary-decision',
      license: 'MIT/research',
      decision_instruction: 'You are an engineering assistant about to act on this request. Decide whether you should ask a clarifying question FIRST, or whether the request is specified well enough to proceed directly. Answer YES if you should ask a clarifying question before starting; answer NO if you should just proceed.',
    });
  }

  // ---- Keep cynefin-classify items ----
  const cynefinItems = loadJsonl('authored/cynefin-classify.jsonl');
  for (const ci of cynefinItems.slice(0, 8)) {  // cap at 8
    const id = nextId('route-cynefin');
    items.push({
      id,
      original_id: ci.id,
      prompt: ci.prompt,
      source: 'cynefin-classify',
      source_file: 'authored/cynefin-classify.jsonl',
      skill_fit: ['cynefin'],
      family: 'Routing/abstention',
      type: 'target',
      target: true,
      label: ci.label,
      mode: 'binary-decision',
      license: 'MIT/research',
      decision_instruction: 'Classify how to engage this problem. Answer YES if it is an UNORDERED problem (complex or chaotic): cause and effect are NOT knowable in advance, so the right move is to probe/experiment and let the approach emerge. Answer NO if it is an ORDERED problem (clear or complicated): cause and effect ARE knowable, so you can analyze and plan a correct solution upfront, possibly with expert help.',
    });
  }

  console.log(`  Total pool: ${items.length} items (${items.filter(i=>i.type==='target').length} target, ${items.filter(i=>i.type==='distractor').length} distractor)`);

  // Save candidate pool
  saveJsonl(items, 'routing-abstention-candidate-pool.jsonl');

  // Build decisive split (no ambiguous items)
  const decisive = items.filter(i => i.type !== 'ambiguous');
  saveJsonl(decisive, 'routing-abstention-decisive.jsonl');

  // Build calibration sample (first 30 non-distractor items)
  const calibSample = items.filter(i => i.type !== 'distractor').slice(0, 30);
  saveJsonl(calibSample, 'routing-abstention-calib-sample.jsonl');

  return { items, decisive, calibSample };
}

// ---- Helper: extract code from prompt ----
function extractCode(prompt) {
  const match = prompt.match(/```c\n?([\s\S]*?)```/);
  return match ? match[1].trim() : prompt;
}

// ---- Main ----
function main() {
  console.log('=== Build Harder Candidate Pools ===');
  console.log(`Output dir: ${OUT}`);

  const secResult = buildHarderSecurityPool();
  const routeResult = buildHarderRoutingPool();

  console.log('\n=== DONE ===');
  console.log(`Security pool: ${secResult.items.length} candidate items (${secResult.decisive.length} decisive)`);
  console.log(`Routing pool:  ${routeResult.items.length} candidate items (${routeResult.decisive.length} decisive)`);
}

main();
