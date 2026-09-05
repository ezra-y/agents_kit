#!/usr/bin/env node
'use strict';

/**
 * Build HARDER candidate item pools for conceptual-reframes and
 * systems-product-strategy-pairwise families.
 *
 * The current pools are ceiling (~100%) for claude-sonnet-4-6. This script
 * sources genuinely harder items where a no-skill solver does NOT trivially
 * produce the correct reframe.
 *
 * CONCEPTUAL-REFRAMES (harder):
 *   - First-principles constraints where the fundamental-vs-conventional
 *     distinction is subtle (not just "physics=true, habit=false")
 *   - Reversibility decisions where the door classification has hidden nuance
 *   - Second-order consequence items with complex interaction effects
 *   - Off-target lookalikes that resemble correct answers but aren't
 *
 * SYSTEMS-PAIRWISE (harder):
 *   - Bottleneck identification where the correct stage is non-obvious
 *     (close calls, multi-bottleneck, Amdahl's law scenarios)
 *   - Margin-of-safety judgments where the adequacy assessment is nuanced
 *
 * Usage:
 *   node evals/datasets/calibrated/build-harder-conceptual-systems-pools.js
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(REPO, 'evals', 'datasets', 'calibrated');

function saveJsonl(items, filename) {
  const filepath = path.join(OUT, filename);
  const text = items.map(i => JSON.stringify(i)).join('\n') + '\n';
  fs.writeFileSync(filepath, text);
  console.log(`  Wrote ${items.length} items → ${filepath}`);
}

// ============================================================================
// CONCEPTUAL-REFRAMES HARDER POOL
// ============================================================================
// These items are designed to be genuinely difficult for claude-sonnet-4-6
// in placebo/baseline mode (no skill guide). The binary distinctions are
// subtle: a constraint that LOOKS fundamental but is actually conventional,
// a door that SEEMS two-way but has hidden irreversibility, a second-order
// effect that is genuinely hard to predict.
// ============================================================================

const conceptualHarderItems = [
  // ---- Hard First-Principles: Tricky FUNDAMENTAL (label=true) ----
  // These constraints genuinely cannot be circumvented but are presented
  // in ways that make them look dismissible as "just policy" or "just habit."

  {
    id: "fp-harder-01",
    prompt: "A SaaS company's engineering team wants to store raw credit card numbers in their application database to simplify future reporting queries. Their security team says they cannot do this because PCI-DSS compliance requires card data to be tokenized or encrypted at rest, and storing raw PANs in an application database would fail their quarterly audit, potentially causing their payment processor to revoke their merchant account.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-02",
    prompt: "A distributed database team claims they can't guarantee exactly-once semantics across a WAN in the presence of network partitions. They explain that the FLP impossibility result proves no asynchronous consensus protocol can guarantee termination with even one faulty node, and the Two Generals Problem shows that perfect coordination over an unreliable channel is impossible. They're proposing at-least-once with idempotency instead.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-03",
    prompt: "A health-tech startup's product manager wants to share de-identified patient data with an AI research partner. Their legal counsel says this cannot be done without patient consent because HIPAA's Privacy Rule requires either patient authorization or a valid de-identification method certified by a qualified statistician, and their current de-identification process hasn't been certified. The research partner refuses to sign a BAA.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-04",
    prompt: "A platform team says their Kubernetes clusters cannot use more than 110 pods per node. Their cloud provider's managed Kubernetes service has a hard limit of 110 pods per node that is enforced by the control plane and cannot be raised through any configuration or support ticket. The team is evaluating virtual-kubelet or node-locality workarounds.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },

  // ---- Hard First-Principles: Tricky CONVENTIONAL (label=false) ----
  // These constraints LOOK fundamental (cite standards, security, compliance)
  // but are actually organizational choices that could be changed.

  {
    id: "fp-harder-05",
    prompt: "A backend team says they cannot add a GraphQL endpoint to their REST API because 'our API gateway's security policy requires all endpoints to follow REST conventions.' The policy document was written internally by the previous platform architect who preferred REST. The API gateway supports GraphQL natively and the security team confirms there's no regulatory or compliance requirement mandating REST.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-06",
    prompt: "A data engineering team says they cannot use a NoSQL database because 'the company's data architecture standards document mandates ACID compliance for all production databases.' The standards document was written five years ago by a committee that has since disbanded, and the proposed use case is for application-level caching where eventual consistency is acceptable and documented. No regulatory requirement mandates ACID.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-07",
    prompt: "A mobile development team says they can't implement end-to-end encryption for chat messages because 'Apple's App Store Review Guidelines require using approved cryptography libraries, and we would need to go through an export compliance review.' Investigation reveals that Apple's guidelines DO require using approved libraries, but the iOS Security framework already provides the necessary encryption APIs that are pre-approved. The export compliance process is a self-classification form that takes 15 minutes.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-08",
    prompt: "An infrastructure team says they cannot use spot instances for their production workloads because 'the FinOps policy requires a minimum of 99.95% availability for all production services.' The FinOps policy is an internal guideline that the same team drafted last quarter, and the workloads in question are fault-tolerant batch processing jobs that can tolerate interruptions. The team has the authority to update the FinOps policy themselves.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-09",
    prompt: "A frontend team says they cannot adopt server-side rendering because 'our security review process requires all new architectural patterns to undergo a 6-week security assessment.' The security review process was implemented as a temporary measure during a previous incident and the CISO recently sent an email saying teams can fast-track reviews for well-understood patterns. SSR is already used by three other teams who completed the review in 3 days.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-10",
    prompt: "A DevOps team says they can't give developers kubectl access to staging clusters because 'ISO 27001 certification requires strict separation of duties between development and operations.' Their ISO 27001 auditor confirmed during the last audit that developer access to non-production environments is acceptable as long as production access is controlled. The team misinterpreted a general principle as a specific prohibition.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },

  // ---- Hard First-Principles: Lookalikes (off-target items that look like FP constraints) ----

  {
    id: "fp-harder-11",
    prompt: "A team is debating whether to use microservices or a monolith for a new greenfield project. The tech lead argues they must use microservices because 'the industry has moved on from monoliths and nobody builds monoliths anymore.' There is no specific technical requirement, scaling need, or organizational constraint driving this decision — it's a three-person team building an internal tool.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },
  {
    id: "fp-harder-12",
    prompt: "A company's ML team says they can't release model weights publicly because 'the responsible AI policy requires a safety review before any public release.' The policy was adopted after the board reviewed AI risk, and the review process has a documented checklist. The team could complete the review but estimates it would take two weeks.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["first-principles"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "binary-decision"
  },

  // ---- Hard Reversibility: Tricky ONE-WAY (label=true) ----
  // These actions are genuinely hard to reverse, but the irreversibility is subtle.

  {
    id: "rv-harder-01",
    prompt: "A startup CEO sends a company-wide Slack message announcing a major strategic pivot — shifting from B2B enterprise to consumer SMB — and asking all teams to stop work on enterprise features immediately. Three senior enterprise sales reps who account for 60% of revenue resign within 48 hours of the announcement, interpreting it as the company abandoning their customer base.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["reversibility"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "Assess this decision before acting. Answer YES if it is a one-way door (hard or impossible to reverse — costly, destructive, or locks you in). Answer NO if it is a two-way door (cheaply and quickly reversible if it turns out wrong).",
    mode: "binary-decision"
  },
  {
    id: "rv-harder-02",
    prompt: "An engineering team changes their primary database from PostgreSQL to MySQL by running a migration script that converts all schemas, data types, and stored procedures. They keep the old PostgreSQL instance running in read-only mode for 30 days as a fallback. The application code has been updated to use MySQL via a new ORM adapter, and the old PostgreSQL adapter code has been deleted from the codebase.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["reversibility"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "Assess this decision before acting. Answer YES if it is a one-way door (hard or impossible to reverse — costly, destructive, or locks you in). Answer NO if it is a two-way door (cheaply and quickly reversible if it turns out wrong).",
    mode: "binary-decision"
  },
  {
    id: "rv-harder-03",
    prompt: "A product team deprecates a free tier that has 50,000 active users, requiring them to upgrade to a paid plan or lose access. The announcement gives 60 days notice. Three months after deprecation, the team decides the churn was too high and wants to restore the free tier — but the deprecation was covered by TechCrunch and 40,000 of those users have already migrated to a competitor.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["reversibility"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "Assess this decision before acting. Answer YES if it is a one-way door (hard or impossible to reverse — costly, destructive, or locks you in). Answer NO if it is a two-way door (cheaply and quickly reversible if it turns out wrong).",
    mode: "binary-decision"
  },

  // ---- Hard Reversibility: Tricky TWO-WAY (label=false) ----
  // These actions LOOK irreversible but actually have viable fallbacks.

  {
    id: "rv-harder-04",
    prompt: "A backend team changes the internal API contract between two services by renaming a field from `user_id` to `account_id` in the response JSON. Both services are owned by the same team, deployed together in the same pod, and the change is coordinated so both services deploy simultaneously via a single CI pipeline. No external consumers depend on this internal API.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["reversibility"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "Assess this decision before acting. Answer YES if it is a one-way door (hard or impossible to reverse — costly, destructive, or locks you in). Answer NO if it is a two-way door (cheaply and quickly reversible if it turns out wrong).",
    mode: "binary-decision"
  },
  {
    id: "rv-harder-05",
    prompt: "A platform team flips a feature flag to enable a new authentication flow for 100% of users. The old authentication flow is preserved behind the flag and can be restored by flipping the flag back. The flag change propagates through the CDN within 30 seconds. No data migration or schema change is involved.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["reversibility"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "Assess this decision before acting. Answer YES if it is a one-way door (hard or impossible to reverse — costly, destructive, or locks you in). Answer NO if it is a two-way door (cheaply and quickly reversible if it turns out wrong).",
    mode: "binary-decision"
  },
  {
    id: "rv-harder-06",
    prompt: "A developer merges a pull request that adds a new optional query parameter `?include_archived=true` to a list endpoint. The parameter defaults to false and is purely additive — all existing API consumers see no change in behavior. If the feature needs to be rolled back, the parameter can simply be ignored by the backend with no client impact.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["reversibility"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "Assess this decision before acting. Answer YES if it is a one-way door (hard or impossible to reverse — costly, destructive, or locks you in). Answer NO if it is a two-way door (cheaply and quickly reversible if it turns out wrong).",
    mode: "binary-decision"
  },

  // ---- Hard Second-Order: Tricky (label=false = second-order undermines) ----
  // These have first-order benefits but subtle second-order problems.

  {
    id: "so-harder-01",
    prompt: "A ride-sharing company is losing drivers to a competitor that offers guaranteed hourly minimum earnings. The company introduces a similar guarantee: drivers earn at least $25/hour including tips, with the company making up any shortfall. In the first month, driver supply increases 30% and wait times drop. The company expects this to sustainably solve the driver shortage and improve market share.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["second-order"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "Consider the full chain of consequences of the proposed action, not just the immediate effect. Answer YES if, accounting for second- and third-order effects (feedback, incentives, adaptation by others), the action will ACHIEVE its stated goal. Answer NO if downstream/second-order effects will UNDERMINE or reverse the stated goal even though the first-order effect looks positive.",
    mode: "binary-decision"
  },
  {
    id: "so-harder-02",
    prompt: "A SaaS company notices that new user activation is low because the onboarding flow requires too many decisions. They redesign the onboarding to make intelligent defaults for every setting, reducing the setup from 12 steps to 2 steps. Activation rates jump from 35% to 65%. The team expects this to also improve long-term retention because users are getting value faster.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["second-order"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "Consider the full chain of consequences of the proposed action, not just the immediate effect. Answer YES if, accounting for second- and third-order effects (feedback, incentives, adaptation by others), the action will ACHIEVE its stated goal. Answer NO if downstream/second-order effects will UNDERMINE or reverse the stated goal even though the first-order effect looks positive.",
    mode: "binary-decision"
  },
  {
    id: "so-harder-03",
    prompt: "An engineering organization is frustrated that bugs take too long to fix because teams don't prioritize them. Leadership introduces a policy where every team must fix all known bugs before starting any new feature work. In the first sprint, the bug count drops 40%. Leadership interprets this as the policy working and expects continued improvement in release quality.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["second-order"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "Consider the full chain of consequences of the proposed action, not just the immediate effect. Answer YES if, accounting for second- and third-order effects (feedback, incentives, adaptation by others), the action will ACHIEVE its stated goal. Answer NO if downstream/second-order effects will UNDERMINE or reverse the stated goal even though the first-order effect looks positive.",
    mode: "binary-decision"
  },
  {
    id: "so-harder-04",
    prompt: "A social media platform is facing criticism for toxic comments. They deploy an AI moderation system that automatically hides comments scored as toxic above a threshold, with human review only for appealed decisions. Reported toxic comments drop 80% in the first month. The team declares the problem solved and shifts engineering resources to other priorities.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["second-order"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "Consider the full chain of consequences of the proposed action, not just the immediate effect. Answer YES if, accounting for second- and third-order effects (feedback, incentives, adaptation by others), the action will ACHIEVE its stated goal. Answer NO if downstream/second-order effects will UNDERMINE or reverse the stated goal even though the first-order effect looks positive.",
    mode: "binary-decision"
  },

  // ---- Hard Second-Order: Achieved (label=true = second-order doesn't undermine) ----

  {
    id: "so-harder-05",
    prompt: "An e-commerce company's search results are slow because the search index rebuild runs synchronously on every product update. They move the index rebuild to an async queue that processes updates within 30 seconds, and search results use the slightly-stale index in the meantime. Search latency drops from 2 seconds to 80ms. The company expects this to improve conversion rates, since search speed is a well-known conversion factor.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["second-order"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "Consider the full chain of consequences of the proposed action, not just the immediate effect. Answer YES if, accounting for second- and third-order effects (feedback, incentives, adaptation by others), the action will ACHIEVE its stated goal. Answer NO if downstream/second-order effects will UNDERMINE or reverse the stated goal even though the first-order effect looks positive.",
    mode: "binary-decision"
  },
  {
    id: "so-harder-06",
    prompt: "A company's internal documentation is scattered across wikis, Google Docs, and README files, making it hard to find information. The engineering team builds a documentation portal that indexes all sources and provides unified search. They seed it with their own team's docs and ask other teams to contribute. Six months later, 70% of engineering docs are searchable through the portal and support tickets caused by outdated docs have dropped 25%.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["second-order"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "Consider the full chain of consequences of the proposed action, not just the immediate effect. Answer YES if, accounting for second- and third-order effects (feedback, incentives, adaptation by others), the action will ACHIEVE its stated goal. Answer NO if downstream/second-order effects will UNDERMINE or reverse the stated goal even though the first-order effect looks positive.",
    mode: "binary-decision"
  },

  // ---- Hard Second-Order: Lookalikes (off-target) ----

  {
    id: "so-harder-07",
    prompt: "A gaming company introduces loot boxes with cosmetic items that can also be earned through gameplay. Players can either grind 10 hours for a rare skin or buy it for $2.99. Revenue increases 40% in the first quarter. The company expects this monetization model to be sustainable because all items are cosmetic and non-competitive.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: ["second-order"],
    family: "Conceptual reframes",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "Consider the full chain of consequences of the proposed action, not just the immediate effect. Answer YES if, accounting for second- and third-order effects (feedback, incentives, adaptation by others), the action will ACHIEVE its stated goal. Answer NO if downstream/second-order effects will UNDERMINE or reverse the stated goal even though the first-order effect looks positive.",
    mode: "binary-decision"
  },

  // ---- Distractors: Off-target items that look like conceptual reframes ----

  {
    id: "conc-dist-01",
    prompt: "Write a Python function to find the longest common subsequence of two strings using dynamic programming. Include time and space complexity analysis.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: [],
    family: "Conceptual reframes",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "distractor"
  },
  {
    id: "conc-dist-02",
    prompt: "Explain the difference between TCP and UDP protocols and give three examples of applications that use each.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: [],
    family: "Conceptual reframes",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "distractor"
  },
  {
    id: "conc-dist-03",
    prompt: "A project manager asks for an estimate of how long it will take to build a user registration system with email verification, password reset, and OAuth integration. Provide a detailed breakdown.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: [],
    family: "Conceptual reframes",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "distractor"
  },
  {
    id: "conc-dist-04",
    prompt: "Compare React, Vue, and Angular for building a dashboard application with real-time data updates. Which would you recommend and why?",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: [],
    family: "Conceptual reframes",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "distractor"
  },
  {
    id: "conc-dist-05",
    prompt: "Design a REST API for a library management system. Include endpoints for books, patrons, checkouts, and reservations. Specify request/response formats.",
    source: "authored-harder-conceptual",
    source_file: "authored/harder-conceptual.jsonl",
    skill_fit: [],
    family: "Conceptual reframes",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "A constraint is stated as a reason something can't be done. Answer YES if the constraint is a FUNDAMENTAL limit (physics, math, hard external/legal requirement) that genuinely cannot be circumvented. Answer NO if it is merely a CONVENTION, habit, or current-implementation assumption that could be challenged or changed.",
    mode: "distractor"
  }
];

// ============================================================================
// SYSTEMS-PRODUCT-STRATEGY-PAIRWISE HARDER POOL
// ============================================================================
// These items make bottleneck identification and margin-of-safety judgments
// genuinely harder. The bottleneck is not always the biggest number, and
// the safety margin assessment requires nuanced reasoning about uncertainty.
// ============================================================================

const systemsHarderItems = [
  // ---- Hard Bottleneck: Subtle identification ----
  // These require reasoning beyond "pick the biggest number."

  {
    id: "toc-harder-01",
    prompt: "A payment processing pipeline handles debit card transactions through: Card Network Auth (90ms), Balance Check (45ms), Fraud Scoring via external API (380ms p50, 2,100ms p99), Ledger Update (15ms), SMS Notification enqueue (5ms). The team is concerned about tail latency during peak hours and proposes adding a read replica for the Ledger Update step to reduce it to 5ms. Would this meaningfully reduce p99 transaction latency?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-02",
    prompt: "A CI pipeline runs: Lint (12s), Type Check (18s), Unit Tests (55s), Integration Tests (48s), Build (35s), Security Scan (52s). The team proposes parallelizing Unit Tests across 4 workers, which would cut it to 14s. Would this meaningfully shorten total pipeline run time?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-03",
    prompt: "A web application request flows through: CDN Edge (3ms), WAF Inspection (8ms), Load Balancer (2ms), App Server Business Logic (85ms), Database Query (72ms), Template Render (65ms). The team proposes adding a Redis cache for database queries that would reduce the DB step to 5ms for cached queries (80% hit rate expected). Would this dramatically improve user-perceived latency?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-04",
    prompt: "A document generation service processes each request: Template Loading from S3 (120ms p50, 850ms p99), Data Collection from 3 microservices in parallel (the slowest takes 400ms), PDF Rendering (180ms), Watermark Application (45ms), CDN Upload (90ms). The team proposes adding a local cache for S3 templates to reduce Template Loading to 5ms. Would this meaningfully reduce the median document generation time?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-05",
    prompt: "An ML inference pipeline processes each image: Image Decode (25ms), Preprocessing/Normalization (35ms), CNN Forward Pass on GPU (140ms), Post-processing/NMS (55ms), Result Serialization (8ms). The team proposes using a faster image decoder that cuts Image Decode to 5ms. Would this meaningfully improve inference throughput?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-06",
    prompt: "A batch data pipeline runs hourly: Extract from Kafka (30s), Deserialize Avro (8s), Validate Schema (5s), Join with Reference Data from Redis (42s), Aggregate Windows (25s), Write to Parquet in S3 (18s). The team proposes switching to a faster Avro deserialization library to reduce Deserialize to 2s. Would this meaningfully reduce total batch processing time?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },

  // ---- Hard Bottleneck: Amdahl's Law / Parallel stages ----

  {
    id: "toc-harder-07",
    prompt: "A video encoding pipeline runs these stages PER FRAME: Motion Estimation (22ms), Motion Compensation (15ms), DCT Transform (8ms), Quantization (5ms), Entropy Coding (12ms). The encoding is done on a single thread per stream. The team proposes parallelizing Motion Estimation across 8 cores using slice-based threading, which could theoretically cut it to 3ms. Would this significantly improve frames-per-second throughput?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-08",
    prompt: "An API gateway processes each request: TLS Termination (4ms), Rate Limit Check (2ms), Auth Token Validation (18ms), Request Routing (1ms), Upstream Proxy (depends on backend). The backend service itself takes 95ms to respond. The gateway team proposes replacing the auth library with a faster one that validates tokens in 4ms. Would this notably reduce the total response time users see?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },

  // ---- Hard Bottleneck: Throughput-based (not latency) ----

  {
    id: "toc-harder-09",
    prompt: "A log processing pipeline has per-stage throughput: Tail Log Files (80,000 lines/s), Parse JSON (65,000 lines/s), Filter by Severity (90,000 lines/s), Batch Insert to ClickHouse (42,000 rows/s), Create Materialized Views (38,000 rows/s). The team proposes rewriting the Parse JSON stage in Rust (currently Python) to achieve 200,000 lines/s. Would this meaningfully improve overall pipeline throughput?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-10",
    prompt: "A notification delivery pipeline processes: Fetch Notification Templates (5,000/s), Personalize Content (4,200/s), Render HTML (3,800/s), Send via Email Provider API (1,200/s), Send via Push Provider API (1,100/s). Email and Push run in parallel after rendering. The team proposes optimizing the Render HTML step with pre-compiled templates to achieve 12,000/s. Would this significantly increase total notifications delivered per second?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },

  // ---- Hard Bottleneck: Yes answers (correctly identify bottleneck) ----

  {
    id: "toc-harder-11",
    prompt: "A search API serves queries through: Spelling Correction (12ms), Query Understanding/NER (22ms), Elasticsearch Query (340ms), Result Reranking (85ms), Response Assembly (15ms). The team proposes migrating from Elasticsearch to a purpose-built vector database that would reduce query time to 45ms. Would this dramatically improve search response time?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-12",
    prompt: "A feature release pipeline has stages: Spec Review (0.5 days), Development (4 days avg), Code Review Queue (8 days avg), QA Testing (1.5 days), Staging Deploy (0.3 days). The team proposes adding a dedicated QA engineer to cut testing to 0.5 days. Would this meaningfully improve time-to-release?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },
  {
    id: "toc-harder-13",
    prompt: "An order processing pipeline serves: Validate Cart (25ms), Reserve Inventory (35ms), Tax Calculation via external API (480ms), Create Order Record (12ms), Publish to Fulfillment Queue (8ms). The team proposes switching to a tax calculation provider with a local SDK that computes taxes in 15ms. Would this dramatically reduce order processing latency?",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["theory-of-constraints"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "binary-decision"
  },

  // ---- Hard Margin-of-Safety: Nuanced assessment ----

  {
    id: "mos-harder-01",
    prompt: "An API team is provisioning rate limit capacity for a new partner integration. The partner's contract guarantees up to 500 requests per second with burst allowance of 2x. The API gateway can scale horizontally but new instances take 90 seconds to warm up. During the previous partner integration, actual traffic reached 3.5x the guaranteed rate within the first week. The team provisions for 2,000 req/s — 4x the guaranteed rate.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["margin-of-safety"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "You are sizing/provisioning a resource under uncertainty. Answer YES if the proposed plan leaves an ADEQUATE safety margin for the stated uncertainty and failure cost. Answer NO if the plan is provisioned too tightly (no meaningful buffer) given the uncertainty and the high cost of running out.",
    mode: "binary-decision"
  },
  {
    id: "mos-harder-02",
    prompt: "A team runs a mission-critical batch payment job that processes payroll for 50,000 employees every other Friday. The job takes 3.5 hours and MUST complete by 6 AM when direct deposits are initiated. The team schedules the job to start at 10 PM Friday, leaving a 4.5-hour buffer for the 3.5-hour job. The job has completed successfully within its window for 47 consecutive runs, but a database maintenance window sometimes overlaps and adds 20-40 minutes of delay.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["margin-of-safety"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are sizing/provisioning a resource under uncertainty. Answer YES if the proposed plan leaves an ADEQUATE safety margin for the stated uncertainty and failure cost. Answer NO if the plan is provisioned too tightly (no meaningful buffer) given the uncertainty and the high cost of running out.",
    mode: "binary-decision"
  },
  {
    id: "mos-harder-03",
    prompt: "A team provisions cloud resources for a Black Friday sale expecting 10x normal traffic. Normal traffic is 2,000 concurrent users, and the system degrades at 18,000 concurrent users. They provision for 22,000 concurrent users — 10% above their expected peak. During the previous Black Friday, a competitor outage drove unexpected traffic that reached 14x normal. An outage during Black Friday means approximately $1.2M in lost revenue per hour.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["margin-of-safety"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are sizing/provisioning a resource under uncertainty. Answer YES if the proposed plan leaves an ADEQUATE safety margin for the stated uncertainty and failure cost. Answer NO if the plan is provisioned too tightly (no meaningful buffer) given the uncertainty and the high cost of running out.",
    mode: "binary-decision"
  },
  {
    id: "mos-harder-04",
    prompt: "A team manages a Redis cluster for session storage with 16GB memory allocated. Current peak usage is 11GB, and usage has grown 5% month-over-month for 6 months. At 14GB the eviction policy starts dropping sessions, logging users out. The team plans to upgrade to 32GB when usage hits 13GB, which based on current trends will be in approximately 3 months. The upgrade process requires a 2-minute failover with zero data loss.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["margin-of-safety"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: true,
    decision_instruction: "You are sizing/provisioning a resource under uncertainty. Answer YES if the proposed plan leaves an ADEQUATE safety margin for the stated uncertainty and failure cost. Answer NO if the plan is provisioned too tightly (no meaningful buffer) given the uncertainty and the high cost of running out.",
    mode: "binary-decision"
  },
  {
    id: "mos-harder-05",
    prompt: "A startup's CTO estimates a database migration will take 3 weeks based on a spike test of 10% of the data. The migration is on the critical path for a Series B fundraise demo. The CTO commits to a 4-week timeline — a 33% buffer. No one on the team has done a database migration at this scale before, and the spike test didn't account for foreign key constraint validation that runs during the full migration.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: ["margin-of-safety"],
    family: "Systems/product/strategy pairwise",
    type: "target",
    target: true,
    label: false,
    decision_instruction: "You are sizing/provisioning a resource under uncertainty. Answer YES if the proposed plan leaves an ADEQUATE safety margin for the stated uncertainty and failure cost. Answer NO if the plan is provisioned too tightly (no meaningful buffer) given the uncertainty and the high cost of running out.",
    mode: "binary-decision"
  },

  // ---- Systems Distractors ----

  {
    id: "sys-dist-01",
    prompt: "Explain how Kubernetes handles pod scheduling and what factors the scheduler considers when placing pods on nodes.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: [],
    family: "Systems/product/strategy pairwise",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "distractor"
  },
  {
    id: "sys-dist-02",
    prompt: "Write a Terraform configuration to provision an AWS EKS cluster with managed node groups, VPC, and IAM roles for pod-level permissions.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: [],
    family: "Systems/product/strategy pairwise",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "distractor"
  },
  {
    id: "sys-dist-03",
    prompt: "Describe how to set up a CI/CD pipeline using GitHub Actions that runs tests, builds Docker images, and deploys to Kubernetes on merge to main.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: [],
    family: "Systems/product/strategy pairwise",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "distractor"
  },
  {
    id: "sys-dist-04",
    prompt: "Compare PostgreSQL and MongoDB for a use case involving time-series IoT sensor data with 100,000 writes per second and real-time dashboards.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: [],
    family: "Systems/product/strategy pairwise",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "distractor"
  },
  {
    id: "sys-dist-05",
    prompt: "Design a rate limiting system for a public API that supports per-user, per-endpoint, and per-IP limits with configurable windows and graceful degradation.",
    source: "authored-harder-systems",
    source_file: "authored/harder-systems.jsonl",
    skill_fit: [],
    family: "Systems/product/strategy pairwise",
    type: "distractor",
    target: false,
    label: null,
    decision_instruction: "You are given a multi-stage pipeline with per-stage timings/capacities and a proposed optimization. Answer YES if optimizing the proposed stage would meaningfully improve end-to-end throughput/latency (it is the binding constraint). Answer NO if it would NOT help meaningfully (the proposed stage is not the bottleneck — some other stage dominates).",
    mode: "distractor"
  }
];

// ---- MAIN ----
console.log('Building harder conceptual-reframes and systems-pairwise pools...\n');

console.log('=== Conceptual-Reframes Harder Pool ===');
console.log(`  ${conceptualHarderItems.length} items`);
const targets = conceptualHarderItems.filter(i => i.target === true && i.type === 'target').length;
const distractors = conceptualHarderItems.filter(i => i.type === 'distractor').length;
const withLabels = conceptualHarderItems.filter(i => i.label !== null && i.label !== undefined).length;
console.log(`  Targets: ${targets}, Distractors: ${distractors}, Labeled: ${withLabels}`);
saveJsonl(conceptualHarderItems, 'conceptual-reframes-harder-pool.jsonl');

console.log('\n=== Systems-Product-Strategy-Pairwise Harder Pool ===');
console.log(`  ${systemsHarderItems.length} items`);
const sysTargets = systemsHarderItems.filter(i => i.target === true && i.type === 'target').length;
const sysDistractors = systemsHarderItems.filter(i => i.type === 'distractor').length;
const sysWithLabels = systemsHarderItems.filter(i => i.label !== null && i.label !== undefined).length;
console.log(`  Targets: ${sysTargets}, Distractors: ${sysDistractors}, Labeled: ${sysWithLabels}`);
saveJsonl(systemsHarderItems, 'systems-product-strategy-pairwise-harder-pool.jsonl');

console.log('\nDone.');
