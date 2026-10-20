namespace Wanxiangli.Ordinal

/// Pairwise likelihoods with stable evaluation.
///
/// WHAT[sphinx-v2-025]: the log-likelihood is computed in log space with `logSigmoid`
/// and `logSumExp`. Computing `log(sigmoid(x))` directly is the classic way to produce
/// `log(0)` at eta = ±1000, and a NaN in a fitting loop is indistinguishable from a
/// modeling failure.

module Pairwise =

    /// Kept private: the public contract is in log space, and exposing a sigmoid invites
    /// callers to reintroduce the log(0) path this module exists to avoid.
    let private sigmoid (x: float) : float =
        let overflowGuard = 500.0
        let clipped = max (-overflowGuard) (min overflowGuard x)
        1.0 / (1.0 + System.Math.Exp(-clipped))

    /// log(sigmoid(x)) = -softplus(-x), computed so that large |x| stays finite.
    let logSigmoid (x: float) : float =
        if x >= 0.0 then
            - System.Math.Log(1.0 + System.Math.Exp(-x))
        else
            x - System.Math.Log(1.0 + System.Math.Exp(x))

    /// log(exp(a) + exp(b)) without ever exponentiating the larger term.
    let logSumExp (a: float) (b: float) : float =
        if a = b then
            a + System.Math.Log(2.0)
        elif a > b then
            a + System.Math.Log(1.0 + System.Math.Exp(b - a))
        else
            b + System.Math.Log(1.0 + System.Math.Exp(a - b))

    /// The log-likelihood of one directional ballot under the declared model.
    ///
    /// eta = theta_winner - theta_loser + beta * positionTerm, and
    /// log p = logSigmoid(eta).
    let directionalLogLikelihood (thetaWinner: float) (thetaLoser: float) (beta: float) (position: float) : float =
        let eta = thetaWinner - thetaLoser + beta * position
        logSigmoid eta

    /// The three-way tie-aware log-likelihood.
    ///
    /// (p_win, p_lose, p_tie) = softmax(eta/2, -eta/2, kappa), so log p_tie uses kappa
    /// and log p_win uses eta/2 - logSumExp. As kappa -> -inf this reduces exactly to
    /// the binomial logistic, which is the consistency check the conformance test runs.
    let tieAwareLogLikelihood
        (thetaLeft: float)
        (thetaRight: float)
        (beta: float)
        (position: float)
        (kappa: float)
        (observedTie: bool)
        : float =
        let eta = thetaLeft - thetaRight + beta * position
        let half = eta / 2.0
        let numerator = if observedTie then kappa else half
        let denominator = logSumExp (logSumExp half -half) kappa
        numerator - denominator

    /// The gradient of the directional log-likelihood w.r.t. (theta_winner, theta_loser,
    /// beta). Returned in that order, so a caller can accumulate into a parameter vector
    /// without re-deriving the chain rule.
    let directionalGradient
        (thetaWinner: float)
        (thetaLoser: float)
        (beta: float)
        (position: float)
        : float * float * float =
        let eta = thetaWinner - thetaLoser + beta * position
        let residual = sigmoid eta
        (residual - 1.0, -(residual - 1.0), (residual - 1.0) * position)
