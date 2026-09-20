# Confidence-gated routing with jev_decide

Jev gives you two axes per question: **what** (choice / score / probability) and **how sure**
(confidence, plus the full probability distribution). Confidence-gated routing uses the second
axis to decide who acts on the answer:

    confidence >= auto   (default 0.80)  ->  let code execute the decision unattended
    confidence >= review (default 0.50)  ->  escalate: ask a frontier model or a second Jev pass
    otherwise                            ->  queue for a human

The choice decides the action; the confidence decides whether the system is allowed to take it.
Raising the thresholds buys accuracy at the cost of automation coverage; lowering them does the
reverse. That trade is the whole point of the pattern.

## Where confidence lives

The plugin returns the provider body verbatim, and the official TypeSafe API reports
confidence on the answer itself:

    answers[key] = { type, choice|score|noul, probabilities, confidence }

choice answers carry .choice plus probabilities and a confidence; score answers carry
.score plus a legend (or probabilities) and a confidence; a yes/no answer carries .noul
(the probability that the answer is yes) and has no confidence field.

Two consequences:

1. Read confidence from answers[key].confidence. When a question type has no confidence
   field — the yes/no primitive — fall back to its probability: .noul, or the maximum of
   .probabilities.
2. Take the probabilities exactly as the provider reports them; do not assume any
   particular rounding rule.

## Choosing thresholds

Never copy 0.80. Calibrate against labelled data from your own workload:

1. Collect N examples with known-correct answers (a few hundred is plenty).
2. Run Jev once per example, record confidence and whether the answer was correct.
3. Sweep the threshold and plot two numbers: accuracy of the auto lane (answers above threshold)
   and coverage (share of examples above threshold). Pick the point where accuracy clears your
   risk bar with acceptable coverage.
4. Re-check after changing the questions: rewording instructions moves the calibration.

Calibration only works because Jev's confidence is trained to be calibrated (RLCD). A confidence
of 0.9 should mean roughly nine out of ten correct, which is what makes a threshold meaningful
rather than decorative.

## Using it from a DSH agent

The tool is registered in every session, so an agent can simply follow the policy:

    Ask jev_decide once with the routing question. Then:
      - confidence >= 0.8  -> act on answers.<key>.choice and report what you did
      - confidence >= 0.5  -> do not act; re-ask a stronger model or re-ask Jev with sharper
                              criteria, and only then decide
      - confidence <  0.5  -> do not act; hand the item to a human queue with the state attached

Keep the thresholds and the question definitions in one file so a human can review them, and
never let the model choose the threshold per call: that reintroduces the guessing the pattern
is designed to remove.

## Pitfalls

- Choosing the best option does not need a threshold. If you only want the most likely choice,
  take the argmax. Confidence is for deciding whether to act unattended.
- probabilities and confidence are different: {technical: 0.73, billing: 0.27} can still carry a
  low confidence, because the model may be unsure of both options.
- Do not use confidence as a quality score for a score-type answer; interpolated scores already
  carry their own uncertainty in the rungs.
- Gate the risky action, not the whole task: routing a ticket is cheap, refunding money is not.
- The provider may rate-limit a key: a calibration sweep of many samples can hit HTTP 429. Pace
  the calls (route-demo.mjs sleeps between samples) and treat the provider's actual responses as
  authoritative; no quota is documented here.

See examples/route-demo.mjs for a runnable implementation of the three lanes and a threshold
sweep over a tiny labelled fixture.
