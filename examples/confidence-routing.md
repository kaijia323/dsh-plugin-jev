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

The plugin returns the provider body verbatim, and the two transports report confidence
differently:

    transport: typesafe (native API)
        answers[key] = { type, choice|score|noul, probabilities, confidence }

    transport: vercel (AI Gateway)
        answers[key] = { type, choice|score|probability, probabilities }   <- no confidence here
        providerMetadata.typesafe.confidence[key]                          <- confidence here
        rounding.probabilityDecimals = 2                                   <- probabilities are rounded

Two consequences:

1. On the Vercel transport, read providerMetadata.typesafe.confidence[key]; fall back to the top
   probability (max of probabilities) when the provider omits it for a question.
2. Probabilities are rounded to two decimals there, so do not set a threshold finer than 0.01.

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
- Free-tier Vercel credits are rate-limited on this model: a calibration sweep of many samples can
  hit HTTP 429. Pace the calls (route-demo.mjs sleeps between samples) or top up to paid credits.
- Rounding can flatten probabilities to 0/1 while confidence stays informative; prefer the
  provider confidence over the rounded distribution when both exist.

See examples/route-demo.mjs for a runnable implementation of the three lanes and a threshold
sweep over a tiny labelled fixture.
