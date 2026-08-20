from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

SCHEMA_VERSION = "0.2"

Role = Literal[
    "head_teacher",
    "live_teacher",
    "teaching_assistant",
    "learning_analyst",
    "task_orchestrator",
]
LearningStatus = Literal["learning", "usable", "fluent"]
Grade = Literal["forgot", "hard", "good", "easy"]
SupportLevel = Literal["none", "light_cue", "strong_cue", "full_model", "unknown"]
EvidenceType = Literal[
    "teacher_model",
    "repetition",
    "prompted",
    "independent",
    "self_repair",
    "corrected_retry",
    "transfer",
    "delayed_retrieval",
    "not_observed",
]
EvidenceOutcome = Literal["success", "partial", "failed", "not_judged"]


class ContractModel(BaseModel):
    schema_version: str = SCHEMA_VERSION


DeliveryPace = Literal["very_slow", "slow", "moderate", "natural", "fast"]


class TargetItem(BaseModel):
    item_id: str = Field(min_length=1)
    sentence: str = Field(min_length=1)
    meaning: str = Field(min_length=1)
    communicative_function: str = Field(min_length=1)
    pattern_explanation: str = Field(min_length=1)
    replaceable_slots: list[str] = Field(min_length=1)
    example_sentences: list[str] = Field(min_length=2)
    new_words: list[str]
    common_errors: list[str]
    transfer_prompts: list[str] = Field(min_length=1)


class MicroScenario(BaseModel):
    scenario_id: str = Field(min_length=1)
    learner_role: str = Field(min_length=1)
    teacher_role: str = Field(min_length=1)
    task: str = Field(min_length=1)
    key_information: str = Field(min_length=1)
    introduction_seconds: int = Field(ge=10, le=20)
    target_item_ids: list[str] = Field(min_length=1, max_length=4)


class RecallPrompts(BaseModel):
    immediate: list[str] = Field(min_length=1)
    interleaved: list[str] = Field(min_length=1)
    final: list[str] = Field(min_length=1)


class FinalReview(BaseModel):
    learner_prompt: str = Field(min_length=1)
    target_item_ids: list[str] = Field(min_length=1)
    completion_signal: str = Field(min_length=1)


class LessonStep(BaseModel):
    step_id: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    teacher_opening: str = ""
    learner_task: str = Field(min_length=1)
    teacher_actions: list[str] = Field(min_length=1)
    target_item_ids: list[str] = Field(default_factory=list)
    stall_support: list[str] = Field(default_factory=list)
    completion_signal: str = Field(min_length=1)
    transition: str = ""
    materials: list[str] = Field(default_factory=list)
    optional: bool = False
    time_hint_minutes: int | None = Field(default=None, ge=1, le=90)
    fallback: str = ""


class LessonPlan(ContractModel):
    lesson_id: str = Field(pattern=r"^L[0-9A-Za-z._-]+$")
    learner_id: str = Field(min_length=1)
    course_plan_id: str = Field(min_length=1)
    plan_version: int = Field(ge=1)
    status: Literal["draft", "ready", "superseded"]
    created_at: datetime
    target_minutes: int = Field(ge=5, le=180)
    lesson_goal: str = Field(min_length=1)
    curriculum_refs: list[str] = Field(min_length=1)
    delivery_pace: DeliveryPace = "moderate"
    required_modules: list[str] = Field(default_factory=list)
    review_item_ids: list[str] = Field(default_factory=list)
    new_item_ids: list[str] = Field(default_factory=list)
    target_items: list[TargetItem] = Field(default_factory=list)
    scenario_brief: list[MicroScenario] = Field(default_factory=list)
    recall_prompts: RecallPrompts | None = None
    hint_ladder: list[str] = Field(default_factory=list)
    answer_reveal_condition: str = ""
    final_review: FinalReview | None = None
    steps: list[LessonStep] = Field(min_length=1)
    source_review_ids: list[str] = Field(default_factory=list)
    teacher_persona_version: str | None = None
    note: str = ""

    @model_validator(mode="after")
    def validate_ready_plan(self) -> "LessonPlan":
        all_items = self.review_item_ids + self.new_item_ids
        if len(all_items) != len(set(all_items)):
            raise ValueError("An item cannot be both review and new in one lesson")
        if self.status != "ready":
            return self

        step_ids = [step.step_id for step in self.steps]
        if len(step_ids) != len(set(step_ids)):
            raise ValueError("Lesson step IDs must be unique")
        required_steps = {step.step_id for step in self.steps if not step.optional}
        if not required_steps:
            raise ValueError("A ready lesson needs at least one required module")
        if set(self.required_modules) != required_steps:
            raise ValueError(
                "required_modules must list every non-optional step and no optional step"
            )

        if not all_items:
            raise ValueError("A ready lesson needs at least one review or new item")
        target_ids = [item.item_id for item in self.target_items]
        if len(target_ids) != len(set(target_ids)):
            raise ValueError("Target item IDs must be unique")
        if set(target_ids) != set(all_items):
            raise ValueError(
                "Every review_item_id and new_item_id needs exactly one complete TargetItem"
            )

        target_id_set = set(target_ids)
        scenario_coverage: set[str] = set()
        for scenario in self.scenario_brief:
            unknown = set(scenario.target_item_ids) - target_id_set
            if unknown:
                raise ValueError(
                    f"Scenario {scenario.scenario_id} references unknown target items: "
                    f"{sorted(unknown)}"
                )
            scenario_coverage.update(scenario.target_item_ids)
        if scenario_coverage != target_id_set:
            raise ValueError("Ready lessons must place every target item in a micro-scenario")

        for step in self.steps:
            unknown = set(step.target_item_ids) - target_id_set
            if unknown:
                raise ValueError(
                    f"Step {step.step_id} references unknown target items: {sorted(unknown)}"
                )
            implicit_targets = set(step.materials) & target_id_set
            if implicit_targets - set(step.target_item_ids):
                raise ValueError(
                    f"Step {step.step_id} must list target material IDs in target_item_ids"
                )
            if step.step_id in required_steps:
                if not step.teacher_opening.strip():
                    raise ValueError(
                        f"Required step {step.step_id} needs teacher_opening"
                    )
                if not step.stall_support or not all(
                    item.strip() for item in step.stall_support
                ):
                    raise ValueError(
                        f"Required step {step.step_id} needs progressive stall_support"
                    )
                if not step.transition.strip():
                    raise ValueError(f"Required step {step.step_id} needs transition")
                if not step.fallback.strip():
                    raise ValueError(f"Required step {step.step_id} needs fallback")
                if not all(item.strip() for item in step.teacher_actions):
                    raise ValueError(
                        f"Required step {step.step_id} has an empty teacher action"
                    )

        if self.recall_prompts is None:
            raise ValueError("A ready lesson needs immediate, interleaved, and final recall")
        if len(self.hint_ladder) < 3 or not all(
            item.strip() for item in self.hint_ladder
        ):
            raise ValueError("A ready lesson needs at least three ordered hint levels")
        if not self.answer_reveal_condition.strip():
            raise ValueError("A ready lesson needs an answer_reveal_condition")
        if self.final_review is None:
            raise ValueError("A ready lesson needs a final_review")
        if set(self.final_review.target_item_ids) != target_id_set:
            raise ValueError("final_review must retrieve every target item")
        return self


class ClassRun(ContractModel):
    class_run_id: str = Field(pattern=r"^CR-[0-9A-Za-z._-]+$")
    lesson_id: str = Field(min_length=1)
    lesson_plan_version: int = Field(ge=1)
    voice_session_id: str = Field(min_length=1)
    started_at: datetime
    status: Literal["review_pending", "reviewed", "unreadable", "abandoned"] = (
        "review_pending"
    )
    note: str = ""


class EvidenceObservation(BaseModel):
    evidence_type: EvidenceType
    support_level: SupportLevel = "unknown"
    outcome: EvidenceOutcome = "not_judged"
    learner_utterance: str = ""
    note: str = ""
    turn_refs: list[str] = Field(default_factory=list)


class ItemStateChange(BaseModel):
    item_id: str = Field(min_length=1)
    observations: list[EvidenceObservation] = Field(min_length=1)
    status_before: LearningStatus | None = None
    status_after: LearningStatus
    grade: Grade
    next_review_at: datetime
    reason: str = Field(min_length=1)


class ErrorUpdate(BaseModel):
    error_id: str = Field(min_length=1)
    item_id: str | None = None
    learner_version: str = Field(min_length=1)
    corrected_version: str = Field(min_length=1)
    note: str = ""


class PersonaChangeEvent(ContractModel):
    event_id: str = Field(min_length=1)
    source: Literal["onboarding", "live_class", "manual", "cycle_review"]
    requested_at: datetime
    scope: Literal["temporary", "persistent"]
    instruction: str = Field(min_length=1)
    status: Literal["proposed", "confirmed", "applied", "rejected"]
    effective_from: datetime | None = None


class PlanningSignals(BaseModel):
    due_item_ids: list[str] = Field(default_factory=list)
    reinforce_item_ids: list[str] = Field(default_factory=list)
    transfer_item_ids: list[str] = Field(default_factory=list)
    candidate_material_ids: list[str] = Field(default_factory=list)
    lesson_direction: Literal["continue", "reinforce", "advance", "safe_review"]
    note: str = ""


class LessonReviewDelta(ContractModel):
    review_id: str = Field(pattern=r"^RV-[0-9A-Za-z._-]+$")
    class_run_id: str = Field(min_length=1)
    lesson_id: str = Field(min_length=1)
    reviewed_at: datetime
    completion: Literal["completed", "partial", "unreadable"]
    item_updates: list[ItemStateChange] = Field(default_factory=list)
    error_updates: list[ErrorUpdate] = Field(default_factory=list)
    persona_change_events: list[PersonaChangeEvent] = Field(default_factory=list)
    planning_signals: PlanningSignals
    user_summary: list[str] = Field(default_factory=list, max_length=4)
    limitations: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def unreadable_has_no_learning_updates(self) -> "LessonReviewDelta":
        if self.completion == "unreadable":
            if self.item_updates or self.error_updates:
                raise ValueError("Unreadable classes cannot update learning evidence")
            if not self.limitations:
                raise ValueError("Unreadable classes must explain the limitation")
        return self


class CycleReview(ContractModel):
    cycle_review_id: str = Field(pattern=r"^CY-[0-9A-Za-z._-]+$")
    period_start: date
    period_end: date
    reviewed_class_run_ids: list[str] = Field(default_factory=list)
    decision: Literal["keep", "adjust", "replan", "defer"]
    evidence_summary: list[str] = Field(default_factory=list)
    progress_signals: list[str] = Field(default_factory=list)
    bottlenecks: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    requires_head_teacher: bool
    head_teacher_response: list[str] = Field(default_factory=list)
    created_at: datetime

    @model_validator(mode="after")
    def validate_decision(self) -> "CycleReview":
        if self.period_end < self.period_start:
            raise ValueError("period_end cannot be before period_start")
        expected = self.decision in {"adjust", "replan"}
        if self.requires_head_teacher != expected:
            raise ValueError(
                "requires_head_teacher must be true only for adjust or replan"
            )
        if self.decision == "defer" and not self.limitations:
            raise ValueError("A deferred review must explain why evidence is insufficient")
        if self.decision != "defer" and not self.reviewed_class_run_ids:
            raise ValueError("A non-deferred review needs at least one reviewed class")
        return self


class ArtifactRef(BaseModel):
    kind: Literal[
        "course_plan",
        "lesson_plan",
        "class_run",
        "lesson_review_delta",
        "cycle_review",
        "persona_change_event",
    ]
    artifact_id: str = Field(min_length=1)
    version: int | None = Field(default=None, ge=1)




KNOWN_HANDOFFS: dict[tuple[str, str], tuple[str, str]] = {
    ("head_teacher", "learning_analyst"): ("setup_schedule", "course_plan"),
    ("head_teacher", "live_teacher"): ("teach_lesson", "lesson_plan"),
    ("live_teacher", "teaching_assistant"): ("review_class", "class_run"),
    ("teaching_assistant", "head_teacher"): (
        "prepare_next_lesson",
        "lesson_review_delta",
    ),
    ("learning_analyst", "head_teacher"): ("revise_plan", "cycle_review"),
}

class Handoff(ContractModel):
    handoff_id: str = Field(pattern=r"^HO-[0-9A-Za-z._-]+$")
    workflow_run_id: str = Field(min_length=1)
    from_role: Role
    to_role: Role
    action: str = Field(min_length=1)
    status: Literal["completed", "skipped", "failed"]
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    created_at: datetime
    idempotency_key: str = Field(min_length=1)
    note: str = ""
    skip_reason: str = ""
    error: str = ""

    @model_validator(mode="after")
    def validate_status_details(self) -> "Handoff":
        if self.status == "completed" and not self.artifacts:
            raise ValueError("A completed handoff must reference at least one artifact")
        if self.status == "skipped" and not self.skip_reason:
            raise ValueError("A skipped handoff must include skip_reason")
        if self.status == "failed" and not self.error:
            raise ValueError("A failed handoff must include error")
        if self.from_role == self.to_role:
            raise ValueError("A handoff must move work to another role")

        route = KNOWN_HANDOFFS.get((self.from_role, self.to_role))
        if self.status == "completed" and route is not None:
            expected_action, expected_artifact = route
            if self.action != expected_action:
                raise ValueError(
                    f"Expected action {expected_action} for "
                    f"{self.from_role} -> {self.to_role}"
                )
            if expected_artifact not in {item.kind for item in self.artifacts}:
                raise ValueError(
                    f"Completed {expected_action} handoff must reference "
                    f"{expected_artifact}"
                )
        return self


CONTRACT_MODELS = {
    "lesson_plan": LessonPlan,
    "class_run": ClassRun,
    "lesson_review_delta": LessonReviewDelta,
    "cycle_review": CycleReview,
    "persona_change_event": PersonaChangeEvent,
    "handoff": Handoff,
}


def validate_contract(kind: str, payload: dict) -> ContractModel:
    try:
        model = CONTRACT_MODELS[kind]
    except KeyError as exc:
        raise ValueError(f"Unknown contract kind: {kind}") from exc
    return model.model_validate(payload)
