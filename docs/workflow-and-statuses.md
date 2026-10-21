# Workflow and statuses

**NEEDS CONFIRMATION.** The briefs describe a candidate lifecycle, not an approved transition table. Values below are modeling proposals. They do not establish mandatory steps, fees, timeouts, payment gates or warranty terms. Confirm the final state graph from the SOW before locking it.

## Candidate repair path

```text
Request -> appointment/assignment -> vendor accepts -> arrival if applicable
 -> inspection/evidence -> estimate -> user decision
 -> payment at approved stage -> parts request/collection when needed
 -> repair -> after-evidence -> quality/rework -> completion
 -> handover/return -> warranty activation if included
```

Service-centre escalation branches where approved, with a user decision and custody events.

| Aggregate           | Candidate states                                                                                                                                                                                | Required design behavior                                                                                  | Pending policy                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Booking             | `REQUESTED`, `SCHEDULED`, `ASSIGNED`, `IN_SERVICE`, `CANCELLED`, `COMPLETED`                                                                                                                    | Append actor/time/state event; separate from payment/assignment.                                          | Scheduling, cancellation/reschedule eligibility, fees/cutoffs, terminal rules. |
| Assignment          | `OFFERED`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `REVOKED`, `COMPLETED`                                                                                                                            | Stale/rejected/expired offer cannot be accepted; reassignment creates history.                            | Offer timeout, matching/ranking and reassignment triggers.                     |
| Repair job          | `NOT_STARTED`, `ARRIVAL_PENDING`, `INSPECTION`, `AWAITING_USER`, `AWAITING_PAYMENT`, `AWAITING_PARTS`, `IN_PROGRESS`, `QUALITY_CHECK`, `REWORK`, `READY_FOR_HANDOVER`, `COMPLETED`, `ESCALATED` | Central transition service checks actor and persisted preconditions; append event. Parts are conditional. | Mandatory steps, payment gate, arrival rules and service channel.              |
| Estimate            | `DRAFT`, `SUBMITTED`, `ACCEPTED`, `REJECTED`, `SUPERSEDED`                                                                                                                                      | Submitted version immutable; decision references version and actor; revisions create versions.            | Expiry, revision constraints, taxes, discounts, diagnostic fee.                |
| Part request        | `REQUESTED`, `APPROVED`, `REJECTED`, `PREPARING`, `READY`, `COLLECTED`, `ISSUED`, `CONSUMED`, `RETURNED`, `CLOSED`                                                                              | Stock changes transactional and ledger-backed; collection idempotent.                                     | Hub assumption, approver, DOA/damaged/return process.                          |
| Payment             | `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `PARTIALLY_REFUNDED`, `REFUNDED`                                                                                                   | Provider-verified events only; attempts distinct; webhook idempotency.                                    | Provider, capture stage, currency, retry, refund and job gate.                 |
| Refund              | `REQUESTED`, `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELLED`                                                                                                                                      | Retain each provider/financial event; do not exceed refundable balance.                                   | Eligibility, approvals, partial/multiple behavior and timing.                  |
| Quality             | `PENDING`, `PASSED`, `FAILED`, `REWORK_REQUIRED`, `WAIVED`                                                                                                                                      | Failed checks record rework/escalation; never delete results.                                             | Checklist, required checks, waiver and escalation authority.                   |
| Warranty            | `NOT_ELIGIBLE`, `PENDING_ACTIVATION`, `ACTIVE`, `EXPIRED`, `VOIDED`                                                                                                                             | Copy effective policy terms at activation; claim has separate history.                                    | Coverage, duration, start date, exclusions and eligibility.                    |
| Support             | `OPEN`, `ASSIGNED`, `IN_PROGRESS`, `WAITING_USER`, `RESOLVED`, `CLOSED`                                                                                                                         | Append status/assignment events and enforce ticket membership.                                            | SLA, escalation, reopen and retention.                                         |
| Service-centre case | `PROPOSED`, `AWAITING_USER`, `ACCEPTED`, `DECLINED`, `IN_TRANSIT`, `RECEIVED`, `DIAGNOSING`, `AWAITING_ESTIMATE`, `IN_REPAIR`, `READY_TO_RETURN`, `CLOSED`                                      | Persist user decision and custody actor/time for every transfer.                                          | Courier, fees, responsible party, declined path and centre access.             |

## Transition implementation criteria

1. One workflow service owns the transition graph, authorization, preconditions and event writes.
2. State and history writes are atomic; conditional updates prevent racing transitions.
3. Optional repair steps remain conditional. A repair needing no part is not blocked by inventory.
4. Admin exceptions require explicit permission, reason and audit event; no generic bypass of financial/custody/evidence controls.
5. Confirmed and forbidden transitions receive integration tests before production enablement.
