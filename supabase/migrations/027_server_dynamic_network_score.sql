-- ============================================================================
-- Migration 027: Server-Provided Dynamic Network Trust Score Engine
-- Ensures identical, real-time, calibrated Network Trust Scores (300-850)
-- across all devices, viewports, and user perspectives while preserving RLS privacy.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_user_trust_score(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_isolated BOOLEAN := FALSE;
  v_is_verified BOOLEAN := FALSE;
  v_is_purged BOOLEAN := FALSE;
  v_today DATE := (now() AT TIME ZONE 'UTC')::DATE;

  v_confirmed_debts_count INT := 0;
  v_active_debts_count INT := 0;
  v_settled_debts_count INT := 0;
  v_disputed_debts_count INT := 0;
  v_rejected_created_count INT := 0;

  v_overdue_active_count INT := 0;
  v_moderate_overdue_count INT := 0;
  v_severe_delinquent_count INT := 0;
  v_overdue_penalty INT := 0;

  v_on_time_settlements INT := 0;
  v_late_settlements INT := 0;
  v_undated_settlements INT := 0;
  v_on_time_points INT := 0;
  v_late_points INT := 0;
  v_undated_points INT := 0;

  v_peer_count INT := 0;
  v_total_borrowed_principal NUMERIC := 0;
  v_total_borrower_cleared NUMERIC := 0;
  v_total_lent_settled NUMERIC := 0;
  v_effective_volume NUMERIC := 0;
  v_clearance_ratio INT := 100;

  v_disputed_payments_count INT := 0;
  v_total_disputes INT := 0;
  v_dispute_penalty INT := 0;
  v_declined_penalty INT := 0;

  v_is_calibrated BOOLEAN := FALSE;
  v_raw_score INT := 650;
  v_score INT := 650;
  v_rating TEXT := 'Good';
  v_rating_color TEXT := 'text-blue-500';

  v_payment_history INT := 0;
  v_debt_clearance INT := 0;
  v_network_breadth INT := 0;
  v_dispute_cleanliness INT := 0;

  v_factors JSONB := '[]'::JSONB;
  v_tips JSONB := '[]'::JSONB;
  v_rec RECORD;
  v_days_past_due INT;
  v_debt_verified_paid NUMERIC;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '00000000-0000-0000-0000-000000000001'::UUID THEN
    RETURN jsonb_build_object(
      'score', -1,
      'rating', 'No Score',
      'ratingColor', 'text-[var(--outline)]',
      'factors', jsonb_build_array(
        jsonb_build_object(
          'name', 'No Credit History',
          'impact', 'neutral',
          'points', 0,
          'description', 'No confirmed loan, debt, or repayment agreements on record. Unrated (-1) until first active or settled agreement.',
          'icon', 'history_toggle_off'
        )
      ),
      'tips', jsonb_build_array('Complete your first loan, debt, or repayment transaction to generate a calibrated network score.'),
      'pillars', jsonb_build_object(
        'paymentHistory', 0,
        'debtClearance', 0,
        'networkBreadth', 0,
        'disputeCleanliness', 0
      ),
      'isCalibrated', false,
      'overdueActiveCount', 0
    );
  END IF;

  SELECT
    COALESCE(is_isolated, FALSE),
    COALESCE(is_verified, FALSE),
    COALESCE(is_purged, FALSE)
  INTO v_is_isolated, v_is_verified, v_is_purged
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_is_purged THEN
    RETURN jsonb_build_object(
      'score', -1,
      'rating', 'No Score',
      'ratingColor', 'text-[var(--outline)]',
      'factors', '[]'::JSONB,
      'tips', '[]'::JSONB,
      'pillars', jsonb_build_object(
        'paymentHistory', 0,
        'debtClearance', 0,
        'networkBreadth', 0,
        'disputeCleanliness', 0
      ),
      'isCalibrated', false,
      'overdueActiveCount', 0
    );
  END IF;

  -- Aggregate core counts across valid non-purged debts involving p_user_id
  SELECT
    COUNT(*) FILTER (WHERE d.status IN ('active', 'settled', 'disputed')),
    COUNT(*) FILTER (WHERE d.status = 'active'),
    COUNT(*) FILTER (WHERE d.status = 'settled'),
    COUNT(*) FILTER (WHERE d.status = 'disputed'),
    COUNT(*) FILTER (WHERE d.status = 'declined' AND d.created_by = p_user_id),
    COUNT(DISTINCT CASE
      WHEN d.status IN ('active', 'settled') THEN
        CASE WHEN d.lender_id = p_user_id THEN d.borrower_id ELSE d.lender_id END
      ELSE NULL
    END)
  INTO
    v_confirmed_debts_count,
    v_active_debts_count,
    v_settled_debts_count,
    v_disputed_debts_count,
    v_rejected_created_count,
    v_peer_count
  FROM public.debts d
  JOIN public.profiles pl ON pl.id = d.lender_id
  JOIN public.profiles pb ON pb.id = d.borrower_id
  WHERE (d.lender_id = p_user_id OR d.borrower_id = p_user_id)
    AND d.status != 'purged'
    AND d.lender_id != '00000000-0000-0000-0000-000000000001'::UUID
    AND d.borrower_id != '00000000-0000-0000-0000-000000000001'::UUID
    AND COALESCE(pl.is_purged, FALSE) = FALSE
    AND COALESCE(pb.is_purged, FALSE) = FALSE
    AND NOT (
      COALESCE(d.notes, '') LIKE '%[TRANSACTION PURGED BY ADMIN%'
      OR COALESCE(d.notes, '') LIKE '%[ADMIN_PURGED:%'
    );

  -- 0. Zero Confirmed History Check (-1 / No Score)
  IF v_confirmed_debts_count = 0 THEN
    RETURN jsonb_build_object(
      'score', -1,
      'rating', 'No Score',
      'ratingColor', 'text-[var(--outline)]',
      'factors', jsonb_build_array(
        jsonb_build_object(
          'name', 'No Credit History',
          'impact', 'neutral',
          'points', 0,
          'description', 'No confirmed loan, debt, or repayment agreements on record. Unrated (-1) until first active or settled agreement.',
          'icon', 'history_toggle_off'
        )
      ),
      'tips', jsonb_build_array('Complete your first loan, debt, or repayment transaction to generate a calibrated network score.'),
      'pillars', jsonb_build_object(
        'paymentHistory', 0,
        'debtClearance', 0,
        'networkBreadth', 0,
        'disputeCleanliness', 0
      ),
      'isCalibrated', false,
      'overdueActiveCount', 0
    );
  END IF;

  -- 1. Base Starting Score (650)
  v_factors := v_factors || jsonb_build_array(
    jsonb_build_object(
      'name', 'Starting Baseline',
      'impact', 'neutral',
      'points', 650,
      'description', 'Neutral benchmark for all verified DebtSync participants',
      'icon', 'shield'
    )
  );

  -- Iterate confirmed debts for overdue, settlement punctuality, and clearance volume
  FOR v_rec IN
    SELECT
      d.id,
      d.lender_id,
      d.borrower_id,
      COALESCE(d.principal, 0) AS principal,
      d.status,
      d.due_date,
      d.settled_at
    FROM public.debts d
    JOIN public.profiles pl ON pl.id = d.lender_id
    JOIN public.profiles pb ON pb.id = d.borrower_id
    WHERE (d.lender_id = p_user_id OR d.borrower_id = p_user_id)
      AND d.status IN ('active', 'settled', 'disputed')
      AND d.lender_id != '00000000-0000-0000-0000-000000000001'::UUID
      AND d.borrower_id != '00000000-0000-0000-0000-000000000001'::UUID
      AND COALESCE(pl.is_purged, FALSE) = FALSE
      AND COALESCE(pb.is_purged, FALSE) = FALSE
      AND NOT (
        COALESCE(d.notes, '') LIKE '%[TRANSACTION PURGED BY ADMIN%'
        OR COALESCE(d.notes, '') LIKE '%[ADMIN_PURGED:%'
      )
  LOOP
    -- Verified non-disputed payments on this debt
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_debt_verified_paid
    FROM public.payments p
    WHERE p.debt_id = v_rec.id
      AND COALESCE(p.is_verified, FALSE) = TRUE
      AND NOT (COALESCE(p.note, '') LIKE '%[DISPUTED]%');

    -- Disputed payments submitted by this user on this debt
    SELECT v_disputed_payments_count + COUNT(*)
    INTO v_disputed_payments_count
    FROM public.payments p
    WHERE p.debt_id = v_rec.id
      AND p.paid_by = p_user_id
      AND (COALESCE(p.note, '') LIKE '%[DISPUTED]%');

    -- Borrower obligations & overdue checks
    IF v_rec.borrower_id = p_user_id THEN
      v_total_borrowed_principal := v_total_borrowed_principal + v_rec.principal;

      IF v_rec.status = 'settled' THEN
        v_total_borrower_cleared := v_total_borrower_cleared + GREATEST(v_rec.principal, v_debt_verified_paid);
      ELSE
        v_total_borrower_cleared := v_total_borrower_cleared + LEAST(v_rec.principal, v_debt_verified_paid);
      END IF;

      -- Overdue check (strictly calendar days past due_date)
      IF v_rec.status = 'active' AND v_rec.due_date IS NOT NULL THEN
        v_days_past_due := v_today - (v_rec.due_date::DATE);
        IF v_days_past_due >= 1 THEN
          v_overdue_active_count := v_overdue_active_count + 1;
          IF v_days_past_due > 30 THEN
            v_severe_delinquent_count := v_severe_delinquent_count + 1;
          ELSIF v_days_past_due > 7 THEN
            v_moderate_overdue_count := v_moderate_overdue_count + 1;
          END IF;
        END IF;
      END IF;
    ELSE
      -- Lender liquidity & settled volume
      IF v_rec.status = 'settled' THEN
        v_total_lent_settled := v_total_lent_settled + GREATEST(v_rec.principal, v_debt_verified_paid);
      ELSE
        v_total_lent_settled := v_total_lent_settled + v_debt_verified_paid;
      END IF;
    END IF;

    -- Settled punctuality (applies primarily to borrower settlements and mutual closures)
    IF v_rec.status = 'settled' THEN
      IF v_rec.due_date IS NULL OR v_rec.settled_at IS NULL THEN
        v_undated_settlements := v_undated_settlements + 1;
      ELSE
        -- 1 day grace window on settlement confirmation
        IF (v_rec.settled_at AT TIME ZONE 'UTC')::DATE <= (v_rec.due_date::DATE + 1) THEN
          v_on_time_settlements := v_on_time_settlements + 1;
        ELSE
          IF v_rec.borrower_id = p_user_id THEN
            v_late_settlements := v_late_settlements + 1;
          ELSE
            v_on_time_settlements := v_on_time_settlements + 1;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 2. Real-Time Overdue Active Debts Penalty
  IF v_overdue_active_count > 0 THEN
    v_overdue_penalty := -(
      v_overdue_active_count * 25
      + v_moderate_overdue_count * 10
      + v_severe_delinquent_count * 30
    );
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Active Overdue Debts',
        'impact', 'negative',
        'points', v_overdue_penalty,
        'description', format(
          '%s active debt%s past due (%s severely delinquent >30 days)',
          v_overdue_active_count,
          CASE WHEN v_overdue_active_count > 1 THEN 's are' ELSE ' is' END,
          v_severe_delinquent_count
        ),
        'icon', 'warning'
      )
    );
    v_tips := v_tips || jsonb_build_array(
      format(
        'Clear your %s overdue active debt%s immediately to recover %s points.',
        v_overdue_active_count,
        CASE WHEN v_overdue_active_count > 1 THEN 's' ELSE '' END,
        abs(v_overdue_penalty)
      )
    );
  ELSIF v_active_debts_count > 0 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Current on Active Ledgers',
        'impact', 'positive',
        'points', 15,
        'description', format(
          '%s active agreement%s maintained in good standing with zero overdue balances',
          v_active_debts_count,
          CASE WHEN v_active_debts_count > 1 THEN 's' ELSE '' END
        ),
        'icon', 'task_alt'
      )
    );
  END IF;

  -- 3. Settled Debts & On-Time Performance
  IF v_on_time_settlements > 0 THEN
    v_on_time_points := LEAST(184, LEAST(8, v_on_time_settlements) * 18 + GREATEST(0, v_on_time_settlements - 8) * 8);
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'On-Time Settlements',
        'impact', 'positive',
        'points', v_on_time_points,
        'description', format(
          '%s debt%s settled on or before agreed due date',
          v_on_time_settlements,
          CASE WHEN v_on_time_settlements > 1 THEN 's' ELSE '' END
        ),
        'icon', 'verified'
      )
    );
  END IF;

  IF v_late_settlements > 0 THEN
    v_late_points := -LEAST(72, v_late_settlements * 12);
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Late Settlements',
        'impact', 'negative',
        'points', v_late_points,
        'description', format(
          '%s debt%s settled past the due date (-12 each)',
          v_late_settlements,
          CASE WHEN v_late_settlements > 1 THEN 's' ELSE '' END
        ),
        'icon', 'history_toggle_off'
      )
    );
    v_tips := v_tips || jsonb_build_array('Settling on or before agreed due dates earns +18 points per debt instead of losing points.');
  END IF;

  IF v_undated_settlements > 0 THEN
    v_undated_points := LEAST(80, LEAST(5, v_undated_settlements) * 12 + GREATEST(0, v_undated_settlements - 5) * 5);
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Completed Open Settlements',
        'impact', 'positive',
        'points', v_undated_points,
        'description', format(
          '%s open agreement%s settled in full',
          v_undated_settlements,
          CASE WHEN v_undated_settlements > 1 THEN 's' ELSE '' END
        ),
        'icon', 'check_circle'
      )
    );
  END IF;

  -- 4. Counterparty Diversity (Cross-Network Breadth)
  IF v_peer_count >= 5 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Broad Network Trust',
        'impact', 'positive',
        'points', 40,
        'description', format('Transactions confirmed across %s distinct counterparties', v_peer_count),
        'icon', 'hub'
      )
    );
  ELSIF v_peer_count >= 3 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Diverse Peer Network',
        'impact', 'positive',
        'points', 25,
        'description', format('Active trusted relationships with %s unique counterparties', v_peer_count),
        'icon', 'groups'
      )
    );
  ELSIF v_peer_count = 2 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Growing Peer Network',
        'impact', 'positive',
        'points', 12,
        'description', 'Verified ledger history across 2 distinct counterparties',
        'icon', 'group_add'
      )
    );
  ELSIF v_confirmed_debts_count > 3 AND v_peer_count <= 1 THEN
    v_tips := v_tips || jsonb_build_array('Transact with more unique network peers to prove broad community trustworthiness.');
  END IF;

  -- 5. Repaid & Settled Capital Volume
  v_effective_volume := ROUND((v_total_borrower_cleared + (v_total_lent_settled * 0.5))::NUMERIC, 2);
  IF v_effective_volume >= 50000 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'High Capital Velocity',
        'impact', 'positive',
        'points', 45,
        'description', format('Substantial proven settlement volume (₹%s cleared)', ROUND(v_effective_volume)::TEXT),
        'icon', 'workspace_premium'
      )
    );
  ELSIF v_effective_volume >= 10000 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Proven Settlement Volume',
        'impact', 'positive',
        'points', 25,
        'description', format('Established volume of ₹%s successfully cleared', ROUND(v_effective_volume)::TEXT),
        'icon', 'payments'
      )
    );
  ELSIF v_effective_volume >= 2500 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Active Settlement Volume',
        'impact', 'positive',
        'points', 15,
        'description', format('Settlements totaling ₹%s verified on-ledger', ROUND(v_effective_volume)::TEXT),
        'icon', 'payments'
      )
    );
  ELSIF v_effective_volume >= 500 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Initial Settlement Volume',
        'impact', 'positive',
        'points', 8,
        'description', format('Initial ₹%s in verified settlements recorded', ROUND(v_effective_volume)::TEXT),
        'icon', 'payments'
      )
    );
  END IF;

  -- 6. Clearance Ratio (Obligations vs Settlements)
  IF v_total_borrowed_principal > 0 THEN
    v_clearance_ratio := LEAST(100, ROUND((v_total_borrower_cleared / v_total_borrowed_principal) * 100)::INT);
  ELSE
    v_clearance_ratio := CASE WHEN v_settled_debts_count > 0 THEN 100 ELSE 90 END;
  END IF;

  IF v_clearance_ratio >= 85 AND v_settled_debts_count > 0 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'High Debt Clearance Rate',
        'impact', 'positive',
        'points', 30,
        'description', format('%s%% of lifetime obligations satisfied', v_clearance_ratio),
        'icon', 'speed'
      )
    );
  ELSIF v_clearance_ratio >= 60 AND v_settled_debts_count > 0 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Solid Clearance Progress',
        'impact', 'positive',
        'points', 15,
        'description', format('%s%% of lifetime obligations satisfied', v_clearance_ratio),
        'icon', 'trending_up'
      )
    );
  ELSIF v_clearance_ratio < 40 AND v_overdue_active_count > 0 THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Low Clearance Velocity',
        'impact', 'negative',
        'points', -25,
        'description', format('Only %s%% of obligations satisfied with active delinquent debts', v_clearance_ratio),
        'icon', 'trending_down'
      )
    );
    v_tips := v_tips || jsonb_build_array('Maintain an obligations clearance rate above 85% to earn +30 bonus points.');
  END IF;

  -- 7. Disputes & Creator-Rejected Proposals
  v_total_disputes := v_disputed_debts_count + v_disputed_payments_count;
  IF v_total_disputes > 0 THEN
    v_dispute_penalty := -(v_total_disputes * 40);
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Contested Disputes',
        'impact', 'negative',
        'points', v_dispute_penalty,
        'description', format(
          '%s contested transaction dispute%s on record (-40 each)',
          v_total_disputes,
          CASE WHEN v_total_disputes > 1 THEN 's' ELSE '' END
        ),
        'icon', 'gavel'
      )
    );
    v_tips := v_tips || jsonb_build_array('Resolve all open transaction disputes to lift point deductions.');
  END IF;

  IF v_rejected_created_count >= 2 THEN
    v_declined_penalty := -LEAST(100, (v_rejected_created_count - 1) * 20);
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Rejected Outbound Proposals',
        'impact', 'negative',
        'points', v_declined_penalty,
        'description', format('%s outbound debt proposals rejected by counterparties', v_rejected_created_count),
        'icon', 'cancel'
      )
    );
    v_tips := v_tips || jsonb_build_array('Ensure counterparty consensus before sending debt terms to avoid rejected proposals.');
  END IF;

  -- 8. Admin Security Isolation / Verification Flag
  IF v_is_isolated THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Account Isolated by Admin',
        'impact', 'negative',
        'points', -150,
        'description', 'Account placed in restricted security quarantine by platform administrator',
        'icon', 'security'
      )
    );
    v_tips := v_tips || jsonb_build_array('Contact support or platform admin to review account isolation status.');
  END IF;

  IF v_is_verified THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Admin-Verified Account',
        'impact', 'positive',
        'points', 25,
        'description', 'Identity and contact details independently verified by administrator',
        'icon', 'verified_user'
      )
    );
  END IF;

  -- 9. Calibration Check
  v_is_calibrated := (v_confirmed_debts_count >= 3 OR v_settled_debts_count >= 1);
  IF NOT v_is_calibrated THEN
    v_factors := v_factors || jsonb_build_array(
      jsonb_build_object(
        'name', 'Building History',
        'impact', 'neutral',
        'points', 0,
        'description', 'Score is provisional until at least 3 transactions or 1 settlement are confirmed',
        'icon', 'hourglass_empty'
      )
    );
    v_tips := v_tips || jsonb_build_array('Complete your first settled transaction to establish full score calibration.');
  END IF;

  -- Calculate Final Clamped Score
  SELECT COALESCE(SUM((elem->>'points')::INT), 650)
  INTO v_raw_score
  FROM jsonb_array_elements(v_factors) AS elem;

  v_score := LEAST(850, GREATEST(300, v_raw_score));

  IF v_score >= 800 THEN
    v_rating := 'Exceptional';
    v_rating_color := 'text-emerald-500';
  ELSIF v_score >= 740 THEN
    v_rating := 'Very Good';
    v_rating_color := 'text-green-500';
  ELSIF v_score >= 670 THEN
    v_rating := 'Good';
    v_rating_color := 'text-blue-500';
  ELSIF v_score >= 580 THEN
    v_rating := 'Fair';
    v_rating_color := 'text-amber-500';
  ELSE
    v_rating := 'Poor';
    v_rating_color := 'text-red-500';
  END IF;

  -- Compute 4 Quantitative Pillars (0 - 100%)
  v_payment_history := LEAST(
    100,
    GREATEST(
      20,
      ROUND(
        100
        - (v_overdue_active_count * 25 + v_late_settlements * 15 + CASE WHEN v_total_disputes > 0 THEN 30 ELSE 0 END)
        + (v_on_time_settlements + v_undated_settlements) * 8
      )::INT
    )
  );

  v_debt_clearance := LEAST(100, GREATEST(15, v_clearance_ratio));

  v_network_breadth := LEAST(
    100,
    GREATEST(20, ROUND((v_peer_count::NUMERIC / 5.0) * 80.0 + CASE WHEN v_settled_debts_count > 0 THEN 20 ELSE 0 END)::INT)
  );

  v_dispute_cleanliness := GREATEST(
    0,
    LEAST(100, ROUND(100 - v_total_disputes * 35 - GREATEST(0, v_rejected_created_count - 1) * 15)::INT)
  );

  IF v_score < 850 AND jsonb_array_length(v_tips) = 0 THEN
    v_tips := v_tips || jsonb_build_array('Maintain timely on-ledger repayments to keep your score in the prime 750+ tier.');
  END IF;

  RETURN jsonb_build_object(
    'score', v_score,
    'rating', v_rating,
    'ratingColor', v_rating_color,
    'factors', v_factors,
    'tips', v_tips,
    'pillars', jsonb_build_object(
      'paymentHistory', v_payment_history,
      'debtClearance', v_debt_clearance,
      'networkBreadth', v_network_breadth,
      'disputeCleanliness', v_dispute_cleanliness
    ),
    'isCalibrated', v_is_calibrated,
    'overdueActiveCount', v_overdue_active_count
  );
END;
$$;

-- Batch RPC: Returns a JSONB map of user_id -> TrustScoreBreakdown for multiple users in 1 roundtrip
CREATE OR REPLACE FUNCTION public.get_batch_trust_scores(p_user_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_result JSONB := '{}'::JSONB;
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN v_result;
  END IF;

  FOR v_uid IN
    SELECT DISTINCT u
    FROM unnest(p_user_ids) AS u
    WHERE u IS NOT NULL
    LIMIT 250
  LOOP
    v_result := v_result || jsonb_build_object(v_uid::TEXT, public.calculate_user_trust_score(v_uid));
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_user_trust_score(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_batch_trust_scores(UUID[]) TO authenticated, anon;
