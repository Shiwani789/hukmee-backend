# Workflow state machines

All lifecycles below are candidate state models derived from the pasted context. Exact transition policy remains subject to Hukmee approval. Do not introduce a state jump, fee, timeout, payment gate or waiver without an approved rule. The existing schema currently has only `REQUESTED`, `ASSIGNED`, `ACCEPTED`, `CANCELLED`, `COMPLETED` booking states; `OFFERED`, `ACCEPTED`, `REJECTED`, `REVOKED` assignment states; and estimate/payment enums. The active subset runs and implements booking request, manual assignment decisions, inspection and estimates; the broader repair/payment/QC/warranty lifecycles below are not active APIs.

## Repair lifecycle

```text
BOOKED -> VENDOR_ASSIGNED -> VENDOR_ACCEPTED
 -> PART_REQUESTED -> PART_READY -> PART_COLLECTED (when parts are required)
 -> VENDOR_ON_THE_WAY -> VENDOR_ARRIVED -> BEFORE_EVIDENCE_COMPLETED
 -> INSPECTION_COMPLETED -> ESTIMATE_SUBMITTED -> USER_APPROVED
 -> PAYMENT_CONFIRMED (at approved policy point)
 -> REPAIR_IN_PROGRESS -> AFTER_EVIDENCE_COMPLETED -> QC_PASSED
 -> COMPLETED -> WARRANTY_ACTIVE (if eligible)
```

Possible branches include assignment rejection/timeout/reassignment, user estimate rejection, cancellation, no-part service, failed QC/rework and service-centre escalation. The state machine must be separate from payment, assignment and inventory states. A transition service should validate actor, ownership/scope, current state and persisted prerequisites atomically, then append an immutable event.

## Supporting aggregates

| Aggregate           | Candidate states / transitions                                                                                                                  | Required invariants                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| KYC                 | `DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED`; rejection and resubmission preserve review history; suspension/expiry only by approved policy | Required configurable documents present; reviewer/time/reason recorded; vendor is not eligible before approval.                       |
| Assignment          | `OFFERED -> ACCEPTED` or `REJECTED`, then possibly `EXPIRED`/`REVOKED` and a new attempt                                                        | Only one active owner unless approved otherwise; eligibility rechecked; retries/reasons recorded.                                     |
| Estimate            | `DRAFT -> SUBMITTED -> ACCEPTED/REJECTED`; revised version supersedes earlier version                                                           | Submitted version is immutable; user decision identifies exact version; revised charge requires fresh approval.                       |
| Payment             | `PENDING -> PROCESSING -> SUCCEEDED/FAILED`; later refund states                                                                                | Only provider-verified callback or authorized cash proof changes payment result; amount/currency/order match; delivery is idempotent. |
| Part request        | `REQUESTED -> APPROVED/REJECTED -> PREPARING -> READY -> COLLECTED/ISSUED -> CONSUMED/RETURNED/CLOSED`                                          | Hub scope, compatibility, reservation/stock rules and movement ledger; no negative stock; DOA/return has disposition.                 |
| Repair/QC           | `NOT_STARTED -> IN_PROGRESS -> QUALITY_CHECK -> PASSED` or `REWORK_REQUIRED -> IN_PROGRESS`                                                     | Mandatory evidence and approved payment/part prerequisites enforced; QC is service-configured and attributable.                       |
| Refund              | `REQUESTED -> APPROVED -> PENDING -> SUCCEEDED/FAILED`                                                                                          | Approval scope, refundable balance, provider reference and reconciliation; request alone is not success.                              |
| Service-centre case | `PROPOSED -> AWAITING_USER -> ACCEPTED/DECLINED`; accepted path records handover, receipt, diagnosis, approved estimate, repair/QC and return   | User decision and custody transfer recorded; each new charge approved.                                                                |
| Warranty            | `PENDING/ACTIVE -> EXPIRED/VOIDED`; separate claim review                                                                                       | Effective terms copied; eligible original service/date/part verified; decisions and evidence retained.                                |
| Complaint           | `OPEN -> ASSIGNED -> IN_PROGRESS -> WAITING_USER -> RESOLVED -> CLOSED`                                                                         | Scope limited to assigned/authorized support; history and policy-controlled SLA.                                                      |

## Prerequisite checks

- Assignment: active account, approved KYC, duty, skill/service match, area, availability and capacity once those policies are configured.
- Arrival: assigned vendor and approved location/verification method; GPS override must be audited.
- Inspection: arrival gate when applicable; evidence requirements follow approved policy.
- Estimate decision: user owns booking; decision binds to submitted estimate version.
- Repair start: approved current estimate and payment/parts checks at approved policy points; no-part jobs follow configured exception.
- Completion: after-repair evidence and all mandatory QC passed; only eligible jobs receive a warranty.
- Inventory/payment: every movement/event reconciled and idempotent; client claims are never authoritative.

The full transition table, cancellation semantics, timeouts, location policy and mandatory evidence are open decisions listed in [OPEN_DECISIONS.md](OPEN_DECISIONS.md).
