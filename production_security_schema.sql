-- ============================================================
-- JADUL KEKINIAN (JDK) - DATABASE METADATA (FUNCTIONS, TRIGGERS, POLICIES)
-- Generated automatically via Supabase Management API
-- ============================================================

-- ------------------------------------------------------------
-- A. CUSTOM FUNCTIONS
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_old_transaction_logs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    DELETE FROM transaction_log 
    WHERE created_at < NOW() - INTERVAL '7 days';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_permissions
    WHERE user_id = auth.uid() AND is_super_admin = TRUE
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_game_stats(p_game_id uuid)
 RETURNS TABLE(total_plays bigint, unique_players bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_plays,
        COUNT(DISTINCT l.user_id) as unique_players
    FROM 
        public.game_play_logs l
    WHERE 
        l.game_id = p_game_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_game_comment_count(p_game_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN (SELECT COUNT(*) FROM game_comments WHERE game_id = p_game_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.add_xp(user_id_val uuid, amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE public.profiles
    SET xp = COALESCE(xp, 0) + amount
    WHERE id = user_id_val;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.add_points(user_id_val uuid, amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE public.profiles
    SET current_points = COALESCE(current_points, 0) + amount
    WHERE id = user_id_val;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_admin_permission(permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  user_perms TEXT[];
  is_super BOOLEAN;
BEGIN
  SELECT permissions, is_super_admin 
  INTO user_perms, is_super
  FROM admin_permissions 
  WHERE user_id = auth.uid();
  
  -- Super admins have all permissions
  IF is_super THEN
    RETURN TRUE;
  END IF;
  
  -- Check if user has the specific permission
  RETURN permission_key = ANY(user_perms);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_duel_challenge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    challenger_name TEXT;
BEGIN
    -- Get challenger username
    SELECT username INTO challenger_name FROM public.profiles WHERE id = NEW.challenger_id;

    -- Insert notification for the challenged user
    INSERT INTO public.jdk_notifications (user_id, type, title, message, meta_data)
    VALUES (
        NEW.challenged_id,
        'DUEL_CHALLENGE',
        'Tantangan Duel Baru! ⚔️',
        '@' || challenger_name || ' menantang kamu duel dengan taruhan ' || NEW.bet_amount || ' Poin!',
        jsonb_build_object('duel_id', NEW.id, 'challenger_id', NEW.challenger_id)
    );

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_event_quota()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        IF (NEW.status = 'confirmed') THEN
            UPDATE public.events 
            SET current_quota = current_quota + 1 
            WHERE id = NEW.event_id;
        END IF;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (OLD.status != 'confirmed' AND NEW.status = 'confirmed') THEN
            UPDATE public.events 
            SET current_quota = current_quota + 1 
            WHERE id = NEW.event_id;
        ELSIF (OLD.status = 'confirmed' AND NEW.status != 'confirmed') THEN
            UPDATE public.events 
            SET current_quota = current_quota - 1 
            WHERE id = NEW.event_id;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        IF (OLD.status = 'confirmed') THEN
            UPDATE public.events 
            SET current_quota = current_quota - 1 
            WHERE id = OLD.event_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_global_xss_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    column_record RECORD;
    new_value TEXT;
    old_value TEXT;
BEGIN
    -- 1. Loop semua kolom teks
    FOR column_record IN 
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = TG_TABLE_SCHEMA 
          AND table_name = TG_TABLE_NAME 
          AND data_type IN ('text', 'character varying')
    LOOP
        -- 2. Ambil nilai BARU (NEW)
        EXECUTE format('SELECT ($1).%I', column_record.column_name) USING NEW INTO new_value;
        
        -- 3. Jika operasi UPDATE, ambil nilai LAMA (OLD) untuk perbandingan
        IF TG_OP = 'UPDATE' THEN
            EXECUTE format('SELECT ($1).%I', column_record.column_name) USING OLD INTO old_value;
            
            -- Jika nilai TIDAK BERUBAH, skip validasi
            -- (IS NOT DISTINCT FROM handles NULL comparison correctly)
            IF new_value IS NOT DISTINCT FROM old_value THEN
                CONTINUE; 
            END IF;
        END IF;

        -- 4. Periksa karakter script berbahaya hanya pada nilai yang baru/berubah
        IF new_value ~ '[<>]' THEN
            RAISE EXCEPTION 'KEAMANAN: Karakter < atau > ditemukan di kolom "%". Data ditolak untuk mencegah XSS.', column_record.column_name;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin_v2()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND user_level = 'Admin'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_trending_games(p_days_ago integer DEFAULT 7)
 RETURNS TABLE(game_id uuid, play_count bigint, unique_players bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        l.game_id,
        COUNT(*) as play_count,
        COUNT(DISTINCT l.user_id) as unique_players
    FROM 
        public.game_play_logs l
    WHERE 
        l.played_at >= (now() - (p_days_ago || ' days')::interval)
    GROUP BY 
        l.game_id
    ORDER BY 
        play_count DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_rewards(p_user_id uuid, p_points integer, p_xp integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.profiles
  SET 
    current_points = COALESCE(current_points, 0) + p_points,
    xp = COALESCE(xp, 0) + p_xp
  WHERE id = p_user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_lobby_tip(sender_id uuid, receiver_id uuid, tip_amount integer, sender_username text, receiver_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    sender_rec RECORD;
    daily_total INTEGER;
    required_xp INTEGER;
BEGIN
    -- 0. Get sender profile info
    SELECT * INTO sender_rec FROM public.profiles WHERE id = sender_id;

    -- 1. Anti-Self-Tip
    IF sender_id = receiver_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Kamu tidak bisa mengirim tip ke diri sendiri.');
    END IF;

    -- 2. Level Requirement (Dynamic Level 3 Check)
    -- Fetch XP requirement for Level 3 from database
    SELECT min_xp INTO required_xp FROM public.level_configs WHERE level = 3 LIMIT 1;
    
    -- Fallback safety if config is missing
    IF required_xp IS NULL THEN
        required_xp := 300;
    END IF;

    -- Check user XP against requirement
    IF COALESCE(sender_rec.xp, 0) < required_xp THEN
        RETURN jsonb_build_object('success', false, 'message', 'Syarat Level: Kamu harus minimal Level 3 (' || required_xp || ' XP) untuk bisa mengirim tip.');
    END IF;

    -- 3. Account Age (Min 24 Jam)
    IF sender_rec.created_at > (now() - interval '24 hours') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Syarat Akun: Akun kamu harus berumur minimal 24 jam untuk bisa mengirim tip.');
    END IF;

    -- 4. Daily Limit (Max 1000 per 24 jam)
    SELECT COALESCE(SUM(ABS(amount)), 0) INTO daily_total 
    FROM public.point_transactions 
    WHERE user_id = sender_id 
      AND type = 'GIFT_SEND' 
      AND created_at > (now() - interval '24 hours');

    IF (daily_total + tip_amount) > 1000 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Batas Harian: Maksimal mengirim 1000 poin per 24 jam. Kamu sudah mengirim ' || daily_total || ' poin hari ini.');
    END IF;

    -- 5. Cek saldo pengirim
    IF sender_rec.current_points < tip_amount THEN
        RETURN jsonb_build_object('success', false, 'message', 'Poin tidak cukup.');
    END IF;

    -- 6. Transaksi Inti
    UPDATE public.profiles SET current_points = current_points - tip_amount WHERE id = sender_id;
    UPDATE public.profiles SET current_points = current_points + tip_amount WHERE id = receiver_id;

    -- 7. Log Transaksi
    INSERT INTO public.point_transactions (user_id, amount, type, description)
    VALUES (sender_id, -tip_amount, 'GIFT_SEND', 'Kirim Tip ke ' || receiver_username);

    INSERT INTO public.point_transactions (user_id, amount, type, description)
    VALUES (receiver_id, tip_amount, 'GIFT_RECEIVE', 'Terima Tip dari ' || sender_username);

    RETURN jsonb_build_object('success', true, 'new_balance', sender_rec.current_points - tip_amount);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_duel_stats_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    round_rec JSONB;
    move_val TEXT;
    winner_id UUID;
    loser_id UUID;
    earnings INT;
BEGIN
    IF OLD.status = 'active' AND NEW.status = 'completed' THEN
        winner_id := NEW.winner_id;
        earnings := NEW.bet_amount;

        IF winner_id = NEW.challenger_id THEN
            loser_id := NEW.challenged_id;
        ELSE
            loser_id := NEW.challenger_id;
        END IF;

        INSERT INTO public.duel_stats (user_id) VALUES (NEW.challenger_id) ON CONFLICT (user_id) DO NOTHING;
        INSERT INTO public.duel_stats (user_id) VALUES (NEW.challenged_id) ON CONFLICT (user_id) DO NOTHING;

        IF winner_id IS NOT NULL THEN
            UPDATE public.duel_stats SET
                total_wins = total_wins + 1,
                total_earnings = total_earnings + earnings,
                win_streak = win_streak + 1,
                best_streak = GREATEST(best_streak, win_streak + 1),
                updated_at = now()
            WHERE user_id = winner_id;

            UPDATE public.duel_stats SET
                total_losses = total_losses + 1,
                total_earnings = total_earnings - earnings,
                win_streak = 0,
                updated_at = now()
            WHERE user_id = loser_id;
        ELSE
            UPDATE public.duel_stats SET total_ties = total_ties + 1, updated_at = now() WHERE user_id = NEW.challenger_id;
            UPDATE public.duel_stats SET total_ties = total_ties + 1, updated_at = now() WHERE user_id = NEW.challenged_id;
        END IF;

        FOR round_rec IN SELECT * FROM jsonb_array_elements(NEW.rounds)
        LOOP
            move_val := round_rec->>'challenger_move';
            IF move_val IS NOT NULL THEN
                UPDATE public.duel_stats SET
                    rock_count = rock_count + (CASE WHEN move_val = 'rock' THEN 1 ELSE 0 END),
                    paper_count = paper_count + (CASE WHEN move_val = 'paper' THEN 1 ELSE 0 END),
                    scissors_count = scissors_count + (CASE WHEN move_val = 'scissors' THEN 1 ELSE 0 END)
                WHERE user_id = NEW.challenger_id;
            END IF;

            move_val := round_rec->>'challenged_move';
            IF move_val IS NOT NULL THEN
                UPDATE public.duel_stats SET
                    rock_count = rock_count + (CASE WHEN move_val = 'rock' THEN 1 ELSE 0 END),
                    paper_count = paper_count + (CASE WHEN move_val = 'paper' THEN 1 ELSE 0 END),
                    scissors_count = scissors_count + (CASE WHEN move_val = 'scissors' THEN 1 ELSE 0 END)
                WHERE user_id = NEW.challenged_id;
            END IF;
        END LOOP;

        UPDATE public.duel_stats SET
            favorite_move = (
                CASE 
                    WHEN rock_count >= paper_count AND rock_count >= scissors_count AND rock_count > 0 THEN 'rock'
                    WHEN paper_count >= rock_count AND paper_count >= scissors_count AND paper_count > 0 THEN 'paper'
                    WHEN scissors_count >= rock_count AND scissors_count >= paper_count AND scissors_count > 0 THEN 'scissors'
                    ELSE 'none'
                END
            )
        WHERE user_id IN (NEW.challenger_id, NEW.challenged_id);

        -- ==========================================
        -- REWARDS & BONUSES
        -- ==========================================
        IF winner_id IS NOT NULL THEN
            -- 1. Point Bonuses for Streaks
            DECLARE
                bonus_points INT := 0;
                current_streak INT;
            BEGIN
                SELECT win_streak INTO current_streak FROM public.duel_stats WHERE user_id = winner_id;
                
                IF current_streak = 3 THEN bonus_points := 100;
                ELSIF current_streak = 5 THEN bonus_points := 250;
                ELSIF current_streak = 10 THEN bonus_points := 1000;
                END IF;
                
                IF bonus_points > 0 THEN
                    UPDATE public.profiles SET current_points = current_points + bonus_points WHERE id = winner_id;
                    INSERT INTO public.point_transactions (user_id, amount, type, description)
                    VALUES (winner_id, bonus_points, 'STREAK_BONUS', 'Win Streak Bonus (' || current_streak || ' Wins)');
                END IF;
            END;

            -- 2. Mystery Box Drop (10% Chance)
            IF random() < 0.1 THEN
                INSERT INTO public.user_inventory (user_id, item_key, item_name, quantity)
                VALUES (winner_id, 'box_mystery_bronze', 'JDK Mystery Box (Bronze)', 1)
                ON CONFLICT (user_id, item_key) DO UPDATE SET quantity = user_inventory.quantity + 1;
            END IF;
        END IF;

    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_daily_quest_reward(quest_id_val uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    q_rec RECORD;
BEGIN
    SELECT * INTO q_rec FROM daily_quests WHERE id = quest_id_val FOR UPDATE;
    
    IF q_rec IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Quest tidak ditemukan.'); END IF;
    IF q_rec.is_claimed THEN RETURN jsonb_build_object('success', false, 'message', 'Hadiah sudah diambil.'); END IF;
    IF q_rec.current_count < q_rec.target_count THEN RETURN jsonb_build_object('success', false, 'message', 'Quest belum selesai.'); END IF;
    
    -- Update Quest
    UPDATE daily_quests SET is_claimed = true WHERE id = quest_id_val;
    
    -- Give Reward
    UPDATE profiles SET current_points = COALESCE(current_points, 0) + q_rec.reward_points WHERE id = q_rec.user_id;
    
    -- Transaction Log
    INSERT INTO point_transactions (user_id, amount, type, description)
    VALUES (q_rec.user_id, q_rec.reward_points, 'QUEST_REWARD', 'Daily Quest Reward: ' || q_rec.quest_type);
    
    RETURN jsonb_build_object('success', true, 'new_points', (SELECT current_points FROM profiles WHERE id = q_rec.user_id));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.open_mystery_box(box_item_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    u_id UUID;
    inv_rec RECORD;
    reward_type TEXT;
    reward_amount INT;
    reward_name TEXT;
    random_val INT;
BEGIN
    u_id := auth.uid();
    IF u_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- 1. Check if user has the box
    SELECT * INTO inv_rec FROM user_inventory 
    WHERE user_id = u_id AND item_key = box_item_key AND quantity > 0
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Kamu tidak memiliki item ini atau item sudah habis.');
    END IF;

    -- 2. Consume 1 box
    UPDATE user_inventory SET quantity = quantity - 1 
    WHERE user_id = u_id AND item_key = box_item_key;

    -- 3. Roll for Reward (Simple RNG)
    random_val := floor(random() * 100); -- 0-99
    
    IF random_val < 70 THEN
        -- 70% chance: Points
        reward_type := 'points';
        reward_amount := 50 + floor(random() * 151); -- 50-200
        reward_name := reward_amount || ' Points';
        
        UPDATE profiles SET current_points = COALESCE(current_points, 0) + reward_amount WHERE id = u_id;
        INSERT INTO point_transactions (user_id, amount, type, description)
        VALUES (u_id, reward_amount, 'UNBOXING', 'Hadiah dari ' || box_item_key);
        
    ELSE
        -- 30% chance: XP
        reward_type := 'xp';
        reward_amount := 10 + floor(random() * 41); -- 10-50
        reward_name := reward_amount || ' XP';
        
        UPDATE profiles SET xp = COALESCE(xp, 0) + reward_amount WHERE id = u_id;
        INSERT INTO xp_transactions (user_id, amount, type, description)
        VALUES (u_id, reward_amount, 'UNBOXING', 'Hadiah dari ' || box_item_key);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'reward_type', reward_type,
        'reward_amount', reward_amount,
        'reward_name', reward_name,
        'message', 'Selamat! Kamu mendapatkan ' || reward_name
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_daily_login()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_profile RECORD;
    v_settings RECORD;
    v_last_login TIMESTAMPTZ;
    v_today DATE;
    v_yesterday DATE;
    v_is_new_day BOOLEAN;
    v_is_consecutive BOOLEAN;
    v_new_streak INTEGER;
    v_xp_to_add INTEGER;
    v_points_to_add INTEGER;
    v_now TIMESTAMPTZ;
    v_new_xp INTEGER;
    v_new_points INTEGER;
BEGIN
    -- Get authenticated user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- Get profile
    SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
    IF v_profile IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Profile not found');
    END IF;

    -- Get settings
    SELECT * INTO v_settings FROM system_settings WHERE id = 1;
    
    v_now := NOW();
    v_today := v_now::DATE;
    v_yesterday := v_today - INTERVAL '1 day';
    v_last_login := COALESCE(v_profile.last_login, '1970-01-01'::TIMESTAMPTZ);

    -- Check if it's a new day
    v_is_new_day := v_last_login::DATE < v_today;

    IF NOT v_is_new_day THEN
        -- Same day, just update timestamp
        UPDATE profiles SET last_login = v_now WHERE id = v_user_id;
        RETURN jsonb_build_object('success', true, 'already_claimed', true, 'message', 'Already logged in today');
    END IF;

    -- Calculate streak
    v_is_consecutive := v_last_login::DATE = v_yesterday;
    IF v_is_consecutive THEN
        v_new_streak := COALESCE(v_profile.login_streak, 0) + 1;
    ELSE
        v_new_streak := 1;
    END IF;

    -- Base rewards from settings
    v_xp_to_add := COALESCE(v_settings.xp_per_login, 10);
    v_points_to_add := COALESCE(v_settings.points_per_login, 10);

    -- Check for Double XP Event
    IF v_settings.double_xp_start IS NOT NULL AND v_settings.double_xp_end IS NOT NULL THEN
        IF v_now >= v_settings.double_xp_start AND v_now <= v_settings.double_xp_end THEN
            v_xp_to_add := v_xp_to_add * 2;
        END IF;
    END IF;

    -- Check for Double Points Event
    IF v_settings.double_points_start IS NOT NULL AND v_settings.double_points_end IS NOT NULL THEN
        IF v_now >= v_settings.double_points_start AND v_now <= v_settings.double_points_end THEN
            v_points_to_add := v_points_to_add * 2;
        END IF;
    END IF;

    -- Calculate new totals
    v_new_xp := COALESCE(v_profile.xp, 0) + v_xp_to_add;
    v_new_points := COALESCE(v_profile.current_points, 0) + v_points_to_add;

    -- Update profile atomically
    UPDATE profiles 
    SET 
        last_login = v_now,
        xp = v_new_xp,
        current_points = v_new_points,
        login_streak = v_new_streak
    WHERE id = v_user_id;

    -- Log XP transaction
    IF v_xp_to_add > 0 THEN
        INSERT INTO xp_transactions (user_id, amount, type, description)
        VALUES (v_user_id, v_xp_to_add, 'DAILY_LOGIN', 'Daily Login Reward (Streak: ' || v_new_streak || ')');
    END IF;

    -- Log Points transaction
    IF v_points_to_add > 0 THEN
        INSERT INTO point_transactions (user_id, amount, type, description)
        VALUES (v_user_id, v_points_to_add, 'DAILY_LOGIN', 'Daily Login Reward (Streak: ' || v_new_streak || ')');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'xp_added', v_xp_to_add,
        'points_added', v_points_to_add,
        'new_xp', v_new_xp,
        'new_points', v_new_points,
        'streak', v_new_streak
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_referral_reward(referrer_code_val text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_user_profile RECORD;
    v_referrer RECORD;
    v_settings RECORD;
    v_referrer_reward INTEGER;
    v_referee_reward INTEGER;
BEGIN
    -- Get authenticated user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- Validate referrer code provided
    IF referrer_code_val IS NULL OR referrer_code_val = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'No referrer code provided');
    END IF;

    -- Get referee profile
    SELECT * INTO v_user_profile FROM profiles WHERE id = v_user_id;
    IF v_user_profile IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Profile not found');
    END IF;

    -- Check if already claimed a referral reward (has referred_by set and has transactions)
    IF v_user_profile.referred_by IS NOT NULL THEN
        -- Check if reward was already given
        IF EXISTS (
            SELECT 1 FROM point_transactions 
            WHERE user_id = v_user_id AND type = 'REFERRAL_WELCOME'
        ) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Referral reward already claimed');
        END IF;
    END IF;

    -- Find referrer by code
    SELECT * INTO v_referrer 
    FROM profiles 
    WHERE referral_code = referrer_code_val OR jdk_id = referrer_code_val;

    IF v_referrer IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid referral code');
    END IF;

    -- Can't refer yourself
    IF v_referrer.id = v_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cannot use your own referral code');
    END IF;

    -- Get reward amounts from settings
    SELECT * INTO v_settings FROM system_settings WHERE id = 1;
    v_referrer_reward := COALESCE(v_settings.referrer_reward, 100);
    v_referee_reward := COALESCE(v_settings.referee_reward, 50);

    -- Update referee profile with referred_by and give points
    UPDATE profiles 
    SET 
        referred_by = referrer_code_val,
        current_points = COALESCE(current_points, 0) + v_referee_reward
    WHERE id = v_user_id;

    -- Give referrer their bonus
    UPDATE profiles 
    SET current_points = COALESCE(current_points, 0) + v_referrer_reward
    WHERE id = v_referrer.id;

    -- Log transactions
    INSERT INTO point_transactions (user_id, amount, type, description)
    VALUES 
        (v_referrer.id, v_referrer_reward, 'REFERRAL_BONUS', 'Bonus referal member baru: ' || v_user_profile.username),
        (v_user_id, v_referee_reward, 'REFERRAL_WELCOME', 'Bonus join menggunakan kode referal: ' || referrer_code_val);

    RETURN jsonb_build_object(
        'success', true,
        'referee_reward', v_referee_reward,
        'message', 'Referral reward claimed successfully!'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_event_registration(event_id_val uuid, full_name_val text, phone_val text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_profile RECORD;
    v_event RECORD;
    v_point_fee INTEGER;
    v_new_points INTEGER;
    v_qr_code TEXT;
    v_registration_id UUID;
    v_timestamp TEXT;
    v_random_part TEXT;
BEGIN
    -- Get authenticated user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- Get profile
    SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
    IF v_profile IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Profile not found');
    END IF;

    -- Get event
    SELECT * INTO v_event FROM events WHERE id = event_id_val;
    IF v_event IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Event not found');
    END IF;

    -- Check if already registered
    IF EXISTS (SELECT 1 FROM event_registrations WHERE user_id = v_user_id AND event_id = event_id_val) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Already registered for this event');
    END IF;

    -- Get point fee
    v_point_fee := COALESCE(v_event.point_fee, 0);

    -- Check if user has enough points
    IF v_point_fee > 0 AND COALESCE(v_profile.current_points, 0) < v_point_fee THEN
        RETURN jsonb_build_object('success', false, 'message', 'Insufficient points. Need ' || v_point_fee || ' points.');
    END IF;

    -- Generate QR code parts
    v_timestamp := TO_CHAR(NOW(), 'YYYYMMDDHH24MISS');
    v_random_part := UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 6));

    -- Create registration
    INSERT INTO event_registrations (user_id, event_id, status, full_name, phone, qr_code)
    VALUES (
        v_user_id, 
        event_id_val, 
        CASE WHEN v_event.price = 'Gratis' THEN 'confirmed' ELSE 'pending' END,
        full_name_val,
        phone_val,
        'JDK-EVT-' || v_timestamp || '-' || v_random_part
    )
    RETURNING id INTO v_registration_id;

    -- Update QR code with registration ID
    v_qr_code := 'JDK-EVT-' || SUBSTR(v_registration_id::TEXT, 1, 8) || '-' || v_timestamp;
    UPDATE event_registrations SET qr_code = v_qr_code WHERE id = v_registration_id;

    -- Deduct points if applicable
    IF v_point_fee > 0 THEN
        v_new_points := COALESCE(v_profile.current_points, 0) - v_point_fee;
        UPDATE profiles SET current_points = v_new_points WHERE id = v_user_id;

        -- Log transaction
        INSERT INTO point_transactions (user_id, amount, type, description)
        VALUES (v_user_id, -v_point_fee, 'registration_fee', 'Biaya pendaftaran event: ' || v_event.title);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'registration_id', v_registration_id,
        'qr_code', v_qr_code,
        'points_deducted', v_point_fee,
        'message', 'Registration successful!'
    );

EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already registered for this event');
WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_product_redemption(product_id_val uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    u_id UUID;
    prod_rec RECORD;
    u_points BIGINT;
BEGIN
    u_id := auth.uid();
    IF u_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- 1. Fetch Product
    SELECT * INTO prod_rec FROM public.products WHERE id = product_id_val FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Barang tidak ditemukan.');
    END IF;

    IF NOT prod_rec.is_redeemable THEN
        RETURN jsonb_build_object('success', false, 'message', 'Barang ini tidak bisa dibeli dengan Point.');
    END IF;

    IF prod_rec.status != 'available' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Barang sudah tidak tersedia.');
    END IF;

    -- STOCK CHECK (New Logic)
    IF NOT prod_rec.is_unlimited THEN
        IF prod_rec.stock <= 0 THEN
             RETURN jsonb_build_object('success', false, 'message', 'Stok habis!');
        END IF;
    END IF;

    -- 2. Fetch User Points
    SELECT current_points INTO u_points FROM public.profiles WHERE id = u_id;
    
    IF u_points < prod_rec.redeem_points THEN
        RETURN jsonb_build_object('success', false, 'message', 'Poin kamu tidak cukup! 😢');
    END IF;

    -- 3. Deduct Points
    UPDATE public.profiles 
    SET current_points = current_points - prod_rec.redeem_points 
    WHERE id = u_id;

    -- 4. Log Transaction
    INSERT INTO public.point_transactions (user_id, amount, type, description)
    VALUES (u_id, -prod_rec.redeem_points, 'REDEEM', 'Beli item: ' || prod_rec.name);

    -- 5. Add to Inventory
    INSERT INTO public.user_inventory (user_id, item_key, item_name, quantity)
    VALUES (u_id, 'redeem_' || lower(replace(prod_rec.name, ' ', '_')), prod_rec.name, 1)
    ON CONFLICT (user_id, item_key) DO UPDATE SET quantity = user_inventory.quantity + 1;

    -- 6. Update Stock (New Logic)
    IF NOT prod_rec.is_unlimited THEN
        UPDATE public.products 
        SET stock = stock - 1 
        WHERE id = product_id_val;

        -- If stock hits 0, mark as sold
        IF (prod_rec.stock - 1) <= 0 THEN
            UPDATE public.products SET status = 'sold' WHERE id = product_id_val;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Berhasil menukar poin! Cek inventory kamu.',
        'new_balance', u_points - prod_rec.redeem_points
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.purchase_sticker_pack(pack_id_val uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_profile RECORD;
    v_pack RECORD;
    v_price INTEGER;
    v_new_points INTEGER;
BEGIN
    -- Get authenticated user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- Get profile
    SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
    IF v_profile IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Profile not found');
    END IF;

    -- Get sticker pack
    SELECT * INTO v_pack FROM sticker_packs WHERE id = pack_id_val;
    IF v_pack IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sticker pack not found');
    END IF;

    -- Check if already owned
    IF EXISTS (SELECT 1 FROM user_sticker_packs WHERE user_id = v_user_id AND pack_id = pack_id_val) THEN
        RETURN jsonb_build_object('success', false, 'message', 'You already own this pack');
    END IF;

    v_price := COALESCE(v_pack.price, 0);

    -- Check balance if not free
    IF v_price > 0 THEN
        IF COALESCE(v_profile.current_points, 0) < v_price THEN
            RETURN jsonb_build_object('success', false, 'message', 'Insufficient points. Need ' || v_price || ' points.');
        END IF;
    END IF;

    -- Unlock the pack
    INSERT INTO user_sticker_packs (user_id, pack_id)
    VALUES (v_user_id, pack_id_val);

    -- Deduct points if not free
    IF v_price > 0 THEN
        v_new_points := COALESCE(v_profile.current_points, 0) - v_price;
        UPDATE profiles SET current_points = v_new_points WHERE id = v_user_id;

        -- Log transaction
        INSERT INTO point_transactions (user_id, amount, type, description)
        VALUES (v_user_id, -v_price, 'PURCHASE', 'Beli Sticker Pack: ' || v_pack.name);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'new_balance', CASE WHEN v_price > 0 THEN v_new_points ELSE v_profile.current_points END,
        'message', 'Sticker pack unlocked!'
    );

EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'message', 'You already own this pack');
WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_balance_tampering()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF current_setting('role', true) = 'authenticated' THEN
        NEW.xp := OLD.xp;
        NEW.current_points := OLD.current_points;
        NEW.coin := OLD.coin;
        NEW.login_streak := OLD.login_streak;
        NEW.referred_by := OLD.referred_by;
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_game_leaderboard(p_game_id uuid, p_limit integer DEFAULT 10, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(user_id uuid, username text, avatar_url text, high_score integer, played_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    WITH TopScores AS (
        SELECT 
            l.user_id,
            MAX(l.score) as max_score,
            MAX(l.played_at) as last_played
        FROM 
            public.game_play_logs l
        WHERE 
            l.game_id = p_game_id
            AND l.score > 0
            AND (p_start_date IS NULL OR l.played_at >= p_start_date)
            AND (p_end_date IS NULL OR l.played_at <= p_end_date)
        GROUP BY 
            l.user_id
    )
    SELECT 
        p.id as user_id,
        p.username,
        p.avatar_url,
        t.max_score as high_score,
        t.last_played as played_at
    FROM 
        TopScores t
    JOIN 
        public.profiles p ON t.user_id = p.id
    ORDER BY 
        t.max_score DESC, t.last_played ASC
    LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reorder_radio_queue(p_request_id uuid, p_direction text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_current_order INTEGER;
    v_target_id UUID;
    v_target_order INTEGER;
BEGIN
    -- Get current song's order
    SELECT COALESCE(sort_order, 0) INTO v_current_order 
    FROM music_queue WHERE id = p_request_id;

    IF p_direction = 'UP' THEN
        -- Find the song above (order less than current, or if same order, older created_at)
        SELECT id, COALESCE(sort_order, 0) INTO v_target_id, v_target_order
        FROM music_queue
        WHERE is_played = false AND status = 'approved'
        AND (sort_order < v_current_order OR (sort_order = v_current_order AND created_at < (SELECT created_at FROM music_queue WHERE id = p_request_id)))
        ORDER BY sort_order DESC, created_at DESC
        LIMIT 1;
    ELSE
        -- Find the song below
        SELECT id, COALESCE(sort_order, 0) INTO v_target_id, v_target_order
        FROM music_queue
        WHERE is_played = false AND status = 'approved'
        AND (sort_order > v_current_order OR (sort_order = v_current_order AND created_at > (SELECT created_at FROM music_queue WHERE id = p_request_id)))
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1;
    END IF;

    IF v_target_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Sudah di ujung antrean');
    END IF;

    -- Swap orders
    -- If they have same order (e.g. 0), we need to differentiate them
    IF v_target_order = v_current_order THEN
        IF p_direction = 'UP' THEN
            UPDATE music_queue SET sort_order = v_current_order - 1 WHERE id = p_request_id;
        ELSE
            UPDATE music_queue SET sort_order = v_current_order + 1 WHERE id = p_request_id;
        END IF;
    ELSE
        UPDATE music_queue SET sort_order = v_target_order WHERE id = p_request_id;
        UPDATE music_queue SET sort_order = v_current_order WHERE id = v_target_id;
    END IF;

    RETURN json_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_approved_request(p_request_id uuid, p_admin_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user_id UUID;
    v_points INTEGER;
    v_title TEXT;
BEGIN
    -- Check if admin
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND user_level IN ('Admin', 'admin', 'superadmin')) THEN
        RETURN json_build_object('success', false, 'error', 'Unauthorized: Admin only');
    END IF;

    -- Get request info
    SELECT requested_by, points_spent, title 
    INTO v_user_id, v_points, v_title
    FROM music_queue 
    WHERE id = p_request_id AND status = 'approved' AND is_played = false;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Lagu tidak ditemukan atau sudah diputar');
    END IF;

    -- Status back to rejected
    UPDATE music_queue
    SET status = 'rejected',
        admin_note = 'Dibatalkan oleh Admin',
        processed_at = NOW(),
        processed_by = p_admin_id
    WHERE id = p_request_id;

    -- Refund points
    UPDATE profiles
    SET current_points = current_points + v_points
    WHERE id = v_user_id;

    -- Log transaction
    INSERT INTO point_transactions (user_id, amount, type, description)
    VALUES (v_user_id, v_points, 'REFUND', 'Lagu dibatalkan oleh Admin: ' || v_title);

    RETURN json_build_object('success', true, 'message', 'Lagu berhasil dibatalkan dan poin dikembalikan');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_next_song()
 RETURNS TABLE(id uuid, youtube_url text, title text, requester_name text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        mq.id,
        mq.youtube_url,
        mq.title,
        p.full_name as requester_name,
        mq.message
    FROM music_queue mq
    LEFT JOIN profiles p ON mq.requested_by = p.id
    WHERE mq.is_played = false
    AND mq.status = 'approved'
    ORDER BY COALESCE(mq.sort_order, 0) ASC, mq.created_at ASC
    LIMIT 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_upcoming_queue(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, title text, requester_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        mq.id,
        mq.title,
        p.full_name as requester_name,
        mq.created_at
    FROM music_queue mq
    LEFT JOIN profiles p ON mq.requested_by = p.id
    WHERE mq.is_played = false
    AND mq.status = 'approved'
    ORDER BY COALESCE(mq.sort_order, 0) ASC, mq.created_at ASC
    LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_now_playing()
 RETURNS TABLE(id uuid, youtube_url text, title text, requester_name text, message text, played_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        mq.id,
        mq.youtube_url,
        mq.title,
        p.full_name as requester_name,
        mq.message,
        mq.played_at
    FROM music_queue mq
    LEFT JOIN profiles p ON mq.requested_by = p.id
    WHERE mq.is_played = true
    AND (mq.status = 'approved' OR mq.status IS NULL) -- Allow old played songs or new approved ones
    ORDER BY mq.played_at DESC
    LIMIT 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_session_rate_limit(p_user_id uuid, p_game_id text, p_max_sessions integer DEFAULT 3, p_window_hours integer DEFAULT 1)
 RETURNS TABLE(allowed boolean, current_count integer, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_count INT;
BEGIN
    -- Count active sessions within the time window
    SELECT COUNT(*) INTO v_count
    FROM game_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND created_at > NOW() - (p_window_hours || ' hours')::INTERVAL;

    -- Check if limit exceeded
    IF v_count >= p_max_sessions THEN
        RETURN QUERY SELECT 
            false, 
            v_count, 
            format('Rate limit exceeded: %s/%s sessions in last %s hour(s)', v_count, p_max_sessions, p_window_hours);
    ELSE
        RETURN QUERY SELECT 
            true, 
            v_count, 
            'OK'::TEXT;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_abandoned_sessions()
 RETURNS TABLE(abandoned_count integer, deleted_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_abandoned INT;
    v_deleted INT;
BEGIN
    -- Mark sessions older than 1 hour as abandoned
    WITH updated AS (
        UPDATE game_sessions
        SET status = 'abandoned',
            end_time = NOW()
        WHERE status = 'active'
        AND start_time < NOW() - INTERVAL '1 hour'
        RETURNING id
    )
    SELECT COUNT(*) INTO v_abandoned FROM updated;

    -- Delete old abandoned sessions (older than 7 days)
    WITH deleted AS (
        DELETE FROM game_sessions
        WHERE status = 'abandoned'
        AND created_at < NOW() - INTERVAL '7 days'
        RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted FROM deleted;

    -- Also delete completed sessions older than 30 days
    WITH deleted_completed AS (
        DELETE FROM game_sessions
        WHERE status = 'completed'
        AND created_at < NOW() - INTERVAL '30 days'
        RETURNING id
    )
    SELECT COUNT(*) + v_deleted INTO v_deleted FROM deleted_completed;

    RETURN QUERY SELECT v_abandoned, v_deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND user_level = 'Admin'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_rekber_stock(p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE products 
    SET 
        stock = stock + 1,
        status = CASE WHEN status = 'sold' THEN 'available' ELSE status END
    WHERE id = p_product_id AND NOT is_unlimited;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_manual_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Jika confirmed_at di-update dari NULL menjadi ADA nilainya
    IF (NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL) THEN
        UPDATE auth.users
        SET email_confirmed_at = NEW.confirmed_at,
            updated_at = now()
        WHERE id = NEW.id;
        
        RAISE NOTICE 'User % has been manually confirmed in Supabase Auth.', NEW.id;
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_rekber_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    tx RECORD;
    hours_pending INTEGER;
    admin_ids UUID[];
BEGIN
    -- Get all admin IDs for notifications
    SELECT array_agg(id) INTO admin_ids 
    FROM profiles WHERE LOWER(user_level) = 'admin';

    FOR tx IN 
        SELECT r.*, p.name as product_name, p.is_unlimited,
               seller.username as seller_username,
               buyer.username as buyer_username
        FROM rekber_transactions r
        JOIN products p ON r.product_id = p.id
        JOIN profiles seller ON r.seller_id = seller.id
        JOIN profiles buyer ON r.buyer_id = buyer.id
        WHERE r.status = 'REQUESTED'
    LOOP
        hours_pending := EXTRACT(EPOCH FROM (now() - tx.created_at)) / 3600;
        
        -- 24 hour reminder to Seller
        IF hours_pending >= 24 AND hours_pending < 25 THEN
            INSERT INTO jdk_notifications (user_id, type, title, message, meta_data)
            VALUES (
                tx.seller_id,
                'REKBER_REMINDER',
                '⏰ Reminder: Rekber Menunggu 24 Jam',
                'Rekber dari @' || tx.buyer_username || ' untuk "' || tx.product_name || '" sudah 24 jam menunggu respons Anda.',
                jsonb_build_object('transaction_id', tx.id)
            );
        END IF;
        
        -- 48 hour urgent reminder
        IF hours_pending >= 48 AND hours_pending < 49 THEN
            -- Notify Seller
            INSERT INTO jdk_notifications (user_id, type, title, message, meta_data)
            VALUES (
                tx.seller_id,
                'REKBER_REMINDER',
                '🚨 URGENT: Rekber Akan Dibatalkan!',
                'Rekber untuk "' || tx.product_name || '" akan OTOMATIS BATAL dalam 24 jam jika tidak direspons!',
                jsonb_build_object('transaction_id', tx.id)
            );
            
            -- Notify Admins
            IF admin_ids IS NOT NULL THEN
                INSERT INTO jdk_notifications (user_id, type, title, message, meta_data)
                SELECT 
                    unnest(admin_ids),
                    'REKBER_ADMIN_ALERT',
                    '⚠️ Rekber Hampir Expired',
                    'Rekber @' || tx.buyer_username || ' → @' || tx.seller_username || ' untuk "' || tx.product_name || '" akan auto-cancel dalam 24 jam.',
                    jsonb_build_object('transaction_id', tx.id);
            END IF;
        END IF;
        
        -- 72 hour auto-cancel
        IF hours_pending >= 72 THEN
            -- 1. Cancel transaction
            UPDATE rekber_transactions SET status = 'CANCELLED' WHERE id = tx.id;
            
            -- 2. Restore stock
            IF NOT tx.is_unlimited THEN
                PERFORM restore_rekber_stock(tx.product_id);
            END IF;
            
            -- 3. System message in chat
            INSERT INTO rekber_messages (transaction_id, content, is_system)
            VALUES (tx.id, '❌ Transaksi dibatalkan otomatis karena Seller tidak merespons dalam 72 jam. Stok dikembalikan.', true);
            
            -- 4. Notify Buyer
            INSERT INTO jdk_notifications (user_id, type, title, message, meta_data)
            VALUES (
                tx.buyer_id,
                'REKBER_CANCELLED',
                '❌ Rekber Dibatalkan Otomatis',
                'Rekber untuk "' || tx.product_name || '" dibatalkan karena Seller tidak merespons dalam 72 jam. Silakan coba lagi atau cari barang lain.',
                jsonb_build_object('transaction_id', tx.id)
            );
            
            -- 5. Notify Seller
            INSERT INTO jdk_notifications (user_id, type, title, message, meta_data)
            VALUES (
                tx.seller_id,
                'REKBER_CANCELLED',
                '❌ Rekber Anda Dibatalkan',
                'Rekber untuk "' || tx.product_name || '" dari @' || tx.buyer_username || ' telah dibatalkan karena tidak direspons dalam 72 jam.',
                jsonb_build_object('transaction_id', tx.id)
            );
            
            -- 6. Notify Admins
            IF admin_ids IS NOT NULL THEN
                INSERT INTO jdk_notifications (user_id, type, title, message, meta_data)
                SELECT 
                    unnest(admin_ids),
                    'REKBER_ADMIN_ALERT',
                    '🗑️ Rekber Auto-Cancelled',
                    'Rekber @' || tx.buyer_username || ' → @' || tx.seller_username || ' untuk "' || tx.product_name || '" telah dibatalkan otomatis.',
                    jsonb_build_object('transaction_id', tx.id);
            END IF;
        END IF;
    END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_record_score(p_user_id uuid, p_game_id uuid, p_score integer, p_played_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_is_admin BOOLEAN;
    v_log_id UUID;
BEGIN
    -- 1. Security Check: Removed to rely on jdk-secure-handler and service_role grant
    -- Verification is handled by verifyAdmin(supabase, userId) in the Edge Function.

    -- 2. Insert into game_play_logs
    INSERT INTO public.game_play_logs (
        game_id, 
        user_id, 
        score, 
        played_at
    ) VALUES (
        p_game_id,
        p_user_id,
        p_score,
        p_played_at
    ) RETURNING id INTO v_log_id;

    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Score recorded successfully',
        'log_id', v_log_id
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_achievement_count(user_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE public.profiles
    SET achievements_unlocked = achievements_unlocked + 1
    WHERE id = user_id_param;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_song_played(p_song_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE music_queue
    SET is_played = true, 
        status = 'played',
        played_at = NOW()
    WHERE id = p_song_id 
    AND (is_played = false OR status = 'approved');

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Song not found or already played');
    END IF;

    RETURN json_build_object('success', true, 'message', 'Lagu ditandai selesai diputar');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_youtube_request(p_user_id uuid, p_youtube_url text, p_title text, p_message text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_current_points INTEGER;
    v_song_id UUID;
    v_points_cost INTEGER;
    v_rate_limit INTEGER;
    v_last_request TIMESTAMPTZ;
BEGIN
    -- Get configurable settings
    SELECT radio_point_cost, radio_rate_limit_minutes 
    INTO v_points_cost, v_rate_limit
    FROM system_settings 
    WHERE id = 1;

    -- Fallbacks
    v_points_cost := COALESCE(v_points_cost, 500);
    v_rate_limit := COALESCE(v_rate_limit, 30);

    -- Check rate limit
    SELECT MAX(created_at) INTO v_last_request
    FROM music_queue
    WHERE requested_by = p_user_id AND created_at > NOW() - (v_rate_limit || ' minutes')::INTERVAL;

    IF v_last_request IS NOT NULL THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Kamu hanya bisa request 1 lagu setiap ' || v_rate_limit || ' menit. Coba lagi nanti ya!'
        );
    END IF;

    -- Check points balance
    SELECT current_points INTO v_current_points FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF v_current_points IS NULL OR v_current_points < v_points_cost THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Poin tidak cukup. Butuh ' || v_points_cost || ' poin, kamu punya ' || COALESCE(v_current_points, 0) || ' poin.'
        );
    END IF;

    -- Deduct points
    UPDATE profiles SET current_points = current_points - v_points_cost WHERE id = p_user_id;

    -- Log transaction
    INSERT INTO point_transactions (user_id, amount, type, description)
    VALUES (p_user_id, -v_points_cost, 'radio_request', 'Request lagu: ' || p_title);

    -- Queue song
    INSERT INTO music_queue (requested_by, youtube_url, title, message, points_spent)
    VALUES (p_user_id, p_youtube_url, p_title, p_message, v_points_cost)
    RETURNING id INTO v_song_id;

    RETURN json_build_object(
        'success', true, 
        'song_id', v_song_id,
        'message', 'Lagu berhasil masuk antrean!'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_login_streak(user_id_param uuid, increment_val integer DEFAULT 1, reset boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF reset THEN
        UPDATE public.profiles
        SET login_streak = 1,
            last_streak_update = now()
        WHERE id = user_id_param;
    ELSE
        UPDATE public.profiles
        SET login_streak = login_streak + increment_val,
            last_streak_update = now()
        WHERE id = user_id_param;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_youtube_request(p_request_id uuid, p_admin_id uuid, p_reason text DEFAULT 'Tidak sesuai kriteria'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user_id UUID;
    v_points INTEGER;
    v_title TEXT;
BEGIN
    -- Check if admin
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND user_level IN ('Admin', 'admin', 'superadmin')) THEN
        RETURN json_build_object('success', false, 'error', 'Unauthorized: Admin only');
    END IF;

    -- Get request info
    SELECT requested_by, points_spent, title 
    INTO v_user_id, v_points, v_title
    FROM music_queue 
    WHERE id = p_request_id AND status = 'pending';

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Request not found or already processed');
    END IF;

    -- Start rejection
    UPDATE music_queue
    SET status = 'rejected',
        admin_note = p_reason,
        processed_at = NOW(),
        processed_by = p_admin_id
    WHERE id = p_request_id;

    -- Refund points
    UPDATE profiles
    SET current_points = current_points + v_points
    WHERE id = v_user_id;

    -- Log transaction
    INSERT INTO point_transactions (user_id, amount, type, description)
    VALUES (v_user_id, v_points, 'REFUND', 'Refund request lagu ditolak: ' || v_title);

    RETURN json_build_object('success', true, 'message', 'Request rejected and points refunded');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_referral_with_jdkid()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- If jdk_id is set, sync referral_code to match it
    IF NEW.jdk_id IS NOT NULL AND NEW.jdk_id != '' THEN
        NEW.referral_code := NEW.jdk_id;
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_youtube_request(p_request_id uuid, p_admin_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Check if admin
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND user_level IN ('Admin', 'admin', 'superadmin')) THEN
        RETURN json_build_object('success', false, 'error', 'Unauthorized: Admin only');
    END IF;

    UPDATE music_queue
    SET status = 'approved',
        processed_at = NOW(),
        processed_by = p_admin_id
    WHERE id = p_request_id AND status = 'pending';

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Request not found or already processed');
    END IF;

    RETURN json_build_object('success', true, 'message', 'Request approved');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.announce_high_score()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    game_name_val TEXT;
    username_val TEXT;
    rank_val INTEGER;
BEGIN
    SELECT name INTO game_name_val FROM games WHERE id = NEW.game_id;
    SELECT username INTO username_val FROM profiles WHERE id = NEW.user_id;

    SELECT rank INTO rank_val FROM (
        SELECT user_id, RANK() OVER (ORDER BY MAX(score) DESC) as rank
        FROM game_play_logs
        WHERE game_id = NEW.game_id
        GROUP BY user_id
    ) t WHERE user_id = NEW.user_id;

    IF rank_val <= 3 AND NEW.score > 0 THEN
        INSERT INTO public.lobby_messages (user_id, content, type)
        VALUES (
            NULL, 
            '📢 **JDK NEWS**: @' || username_val || ' baru saja mencetak skor ' || NEW.score || ' di game **' || game_name_val || '** dan menduduki Rank #' || rank_val || '! 🔥',
            'system'
        );
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_violations(p_user_id uuid, p_days integer DEFAULT 7)
 RETURNS TABLE(violation_date timestamp with time zone, event_type text, game_id text, details jsonb, notification_sent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        sl.created_at as violation_date,
        sl.event_type,
        sl.game_id,
        sl.details,
        sl.notification_sent
    FROM security_logs sl
    WHERE sl.user_id = p_user_id
    AND sl.created_at > NOW() - (p_days || ' days')::INTERVAL
    ORDER BY sl.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_event_attendance_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_xp INTEGER;
    v_points INTEGER;
    v_event_title TEXT;
    v_achievement_id UUID;
    v_is_admin BOOLEAN;
    v_is_host BOOLEAN;
BEGIN
    -- SECURITY CHECK: Who is performing this update?
    -- 1. Check if Admin
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND LOWER(user_level) = 'admin'
    ) INTO v_is_admin;

    -- 2. Check if Host of this specific event
    SELECT EXISTS (
        SELECT 1 FROM public.events 
        WHERE id = NEW.event_id AND host_id = auth.uid()
    ) INTO v_is_host;

    -- 3. Enforce Authorization
    -- Only check permissions when status is changing to 'attended'
    IF (NEW.status = 'attended' AND (OLD.status IS NULL OR OLD.status != 'attended')) THEN
        -- NEW: Allow service_role to bypass (for Edge Function compatibility)
        -- We check both auth.role() and JWT claims as common Supabase patterns
        IF NOT v_is_admin AND NOT v_is_host AND auth.role() != 'service_role' THEN
            RAISE EXCEPTION 'Unauthorized: Only event hosts or admins can mark attendance.';
        END IF;

        -- 4. ANTI-ABUSE: Prevent non-admin hosts from rewarding themselves
        IF auth.uid() = NEW.user_id AND NOT v_is_admin AND auth.role() != 'service_role' THEN
            RAISE EXCEPTION 'Security Policy: For audit integrity, you cannot mark your own attendance for rewards. Please ask an Admin or another Host to scan your ticket.';
        END IF;
    END IF;

    -- Only trigger reward logic when status changes to 'attended'
    -- AND we haven't disbursed rewards yet (using OLD status to prevent client-side spoofing)
    IF (NEW.status = 'attended' AND (OLD.status IS NULL OR OLD.status != 'attended')) THEN
        IF (OLD.reward_status IS NULL OR OLD.reward_status != 'disbursed') THEN
            
            -- Get Event Data
            SELECT title, xp_reward, point_reward, reward_achievement_id 
            INTO v_event_title, v_xp, v_points, v_achievement_id
            FROM public.events 
            WHERE id = NEW.event_id;

            -- 1. Update Profile (XP & Points)
            -- Use SECURITY DEFINER so this runs even if the calling user (host) 
            -- doesn't have direct UPDATE permission on the profiles table.
            UPDATE public.profiles 
            SET 
                xp = COALESCE(xp, 0) + COALESCE(v_xp, 0),
                current_points = COALESCE(current_points, 0) + COALESCE(v_points, 0)
            WHERE id = NEW.user_id;

            -- 2. Log XP Transaction
            IF COALESCE(v_xp, 0) > 0 THEN
                INSERT INTO public.xp_transactions (user_id, amount, type, description)
                VALUES (NEW.user_id, v_xp, 'EVENT_REWARD', 'Hadir di event: ' || COALESCE(v_event_title, 'Event'));
            END IF;

            -- 3. Log Point Transaction
            IF COALESCE(v_points, 0) > 0 THEN
                INSERT INTO public.point_transactions (user_id, amount, type, description)
                VALUES (NEW.user_id, v_points, 'reward', 'Hadir di event: ' || COALESCE(v_event_title, 'Event'));
            END IF;

            -- 4. Mark as disbursed in the NEW record
            -- This ensures that even if status is later changed back/forth, 
            -- the 'reward_status' remains 'disbursed' because OLD.reward_status check will fail next time.
            NEW.reward_status := 'disbursed';
            NEW.attended_at := now();

            -- 5. Grant Achievement Badge if exists
            IF v_achievement_id IS NOT NULL THEN
                -- Check if user already has it
                IF NOT EXISTS (SELECT 1 FROM public.user_achievements WHERE user_id = NEW.user_id AND achievement_id = v_achievement_id) THEN
                    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_reason)
                    VALUES (NEW.user_id, v_achievement_id, 'Hadir di event: ' || COALESCE(v_event_title, 'Event'));
                END IF;
            END IF;

            -- 6. Generic Event Achievements Check
            DECLARE
                v_attended_count INTEGER;
                v_enthusiast_id UUID;
                v_master_id UUID;
            BEGIN
                SELECT COUNT(*) INTO v_attended_count 
                FROM public.event_registrations 
                WHERE user_id = NEW.user_id AND status = 'attended';

                -- Get Achievement IDs by title
                SELECT id INTO v_enthusiast_id FROM public.achievements WHERE title = 'Event Enthusiast' LIMIT 1;
                SELECT id INTO v_master_id FROM public.achievements WHERE title = 'Event Master' LIMIT 1;

                -- First Attendance
                IF v_attended_count = 1 AND v_enthusiast_id IS NOT NULL THEN
                    IF NOT EXISTS (SELECT 1 FROM public.user_achievements WHERE user_id = NEW.user_id AND achievement_id = v_enthusiast_id) THEN
                        INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_reason)
                        VALUES (NEW.user_id, v_enthusiast_id, 'First Event Attendance');
                    END IF;
                END IF;

                -- 10th Attendance
                IF v_attended_count >= 10 AND v_master_id IS NOT NULL THEN
                    IF NOT EXISTS (SELECT 1 FROM public.user_achievements WHERE user_id = NEW.user_id AND achievement_id = v_master_id) THEN
                        INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_reason)
                        VALUES (NEW.user_id, v_master_id, 'Attended 10 Events');
                    END IF;
                END IF;
            END;

        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_security_violation(p_user_id uuid, p_event_type text, p_game_id text, p_session_id uuid, p_details jsonb, p_send_notification boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO security_logs (
        user_id,
        event_type,
        game_id,
        session_id,
        details,
        notification_sent
    )
    VALUES (
        p_user_id,
        p_event_type,
        p_game_id,
        p_session_id,
        p_details,
        NOT p_send_notification -- If we don't want to send, mark as already sent
    )
    RETURNING id INTO v_log_id;

    -- Update game session with violation info if session exists
    IF p_session_id IS NOT NULL THEN
        UPDATE game_sessions
        SET 
            violation_type = p_event_type,
            attempted_score = (p_details->>'score')::INTEGER
        WHERE id = p_session_id;
    END IF;

    RETURN v_log_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_notification_sent(p_log_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE security_logs
    SET 
        notification_sent = true,
        notification_sent_at = NOW()
    WHERE id = p_log_id;

    RETURN FOUND;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_song_request(p_request_id uuid, p_admin_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_request RECORD;
BEGIN
    SELECT * INTO v_request FROM music_requests WHERE id = p_request_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Request tidak ditemukan');
    END IF;

    IF v_request.status != 'pending' THEN
        RETURN json_build_object('success', false, 'error', 'Request sudah diproses sebelumnya');
    END IF;

    UPDATE music_requests
    SET status = 'approved', processed_at = NOW(), processed_by = p_admin_id
    WHERE id = p_request_id;

    RETURN json_build_object('success', true, 'message', 'Lagu disetujui!');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refund_song_points(p_request_id uuid, p_admin_id uuid, p_reason text DEFAULT 'Request ditolak oleh DJ'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_request RECORD;
BEGIN
    -- Get request details (with lock)
    SELECT * INTO v_request FROM music_requests WHERE id = p_request_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Request tidak ditemukan');
    END IF;

    IF v_request.status != 'pending' THEN
        RETURN json_build_object('success', false, 'error', 'Request sudah diproses sebelumnya');
    END IF;

    -- Refund points
    UPDATE profiles SET current_points = current_points + v_request.points_spent
    WHERE id = v_request.user_id;

    -- Log refund
    INSERT INTO point_transactions (user_id, amount, type, description)
    VALUES (v_request.user_id, v_request.points_spent, 'radio_refund', 'Refund: ' || p_reason);

    -- Update request status
    UPDATE music_requests
    SET status = 'rejected', admin_note = p_reason, processed_at = NOW(), processed_by = p_admin_id
    WHERE id = p_request_id;

    RETURN json_build_object('success', true, 'message', 'Request ditolak dan poin dikembalikan');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_song_request(p_user_id uuid, p_song_title text, p_artist_name text, p_spotify_url text, p_message text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_current_points INTEGER;
    v_request_id UUID;
    v_last_request TIMESTAMPTZ;
    v_points_cost INTEGER;
    v_rate_limit INTEGER;
    v_clean_message TEXT;
    v_mentions JSONB;
    v_mention TEXT;
    v_mentioned_users TEXT[];
BEGIN
    -- Get configurable settings from singleton row (id=1)
    SELECT radio_point_cost, radio_rate_limit_minutes 
    INTO v_points_cost, v_rate_limit
    FROM system_settings 
    WHERE id = 1;

    -- Fallbacks
    v_points_cost := COALESCE(v_points_cost, 500);
    v_rate_limit := COALESCE(v_rate_limit, 30);

    -- 1. Check rate limit
    SELECT MAX(created_at) INTO v_last_request
    FROM music_requests
    WHERE user_id = p_user_id AND created_at > NOW() - (v_rate_limit || ' minutes')::INTERVAL;

    IF v_last_request IS NOT NULL THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Kamu hanya bisa request 1 lagu setiap ' || v_rate_limit || ' menit. Coba lagi nanti ya!'
        );
    END IF;

    -- 2. Check points balance (with row lock)
    SELECT current_points INTO v_current_points FROM profiles WHERE id = p_user_id FOR UPDATE;

    IF v_current_points IS NULL OR v_current_points < v_points_cost THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Poin tidak cukup. Butuh ' || v_points_cost || ' poin, kamu punya ' || COALESCE(v_current_points, 0) || ' poin.'
        );
    END IF;

    -- 3. Sanitize message (remove HTML tags and limit length)
    IF p_message IS NOT NULL THEN
        v_clean_message := REGEXP_REPLACE(p_message, '<[^>]*>', '', 'g');
        v_clean_message := SUBSTRING(v_clean_message, 1, 500);
        
        -- Extract mentions (@username format)
        v_mentioned_users := ARRAY(
            SELECT DISTINCT LOWER(match[1])
            FROM REGEXP_MATCHES(v_clean_message, '@([a-zA-Z0-9_-]+)', 'g') AS match
        );
        
        -- Validate mentions against profiles table
        IF array_length(v_mentioned_users, 1) > 0 THEN
            SELECT jsonb_agg(username)
            INTO v_mentions
            FROM profiles
            WHERE LOWER(username) = ANY(v_mentioned_users);
        ELSE
            v_mentions := '[]'::jsonb;
        END IF;
    ELSE
        v_clean_message := NULL;
        v_mentions := '[]'::jsonb;
    END IF;

    -- 4. Deduct points
    UPDATE profiles SET current_points = current_points - v_points_cost WHERE id = p_user_id;

    -- 5. Log point transaction
    INSERT INTO point_transactions (user_id, amount, type, description)
    VALUES (p_user_id, -v_points_cost, 'radio_request', 'Request lagu: ' || p_song_title || ' - ' || p_artist_name);

    -- 6. Create music request with message and mentions
    INSERT INTO music_requests (user_id, song_title, artist_name, spotify_url, points_spent, message, mentions)
    VALUES (p_user_id, p_song_title, p_artist_name, p_spotify_url, v_points_cost, v_clean_message, v_mentions)
    RETURNING id INTO v_request_id;

    RETURN json_build_object(
        'success', true, 
        'request_id', v_request_id,
        'mentions', v_mentions,
        'message', 'Request lagu berhasil! DJ akan segera review.'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_radio_queue()
 RETURNS TABLE(id uuid, song_title text, artist_name text, spotify_url text, requester_name text, approved_at timestamp with time zone, message text, mentions jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        mr.id,
        mr.song_title,
        mr.artist_name,
        mr.spotify_url,
        p.full_name as requester_name,
        mr.processed_at as approved_at,
        mr.message,
        mr.mentions,
        mr.created_at
    FROM music_requests mr
    LEFT JOIN profiles p ON mr.user_id = p.id
    WHERE mr.status = 'approved'
    ORDER BY mr.processed_at ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_old_lobby_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  DELETE FROM public.lobby_messages WHERE created_at < NOW() - INTERVAL '24 hours';
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_mention_notifications(p_request_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_request RECORD;
    v_mention TEXT;
    v_mentioned_user_id UUID;
    v_notification_count INTEGER := 0;
BEGIN
    -- Get request info
    SELECT mr.*, p.username as requester_username, p.full_name as requester_name
    INTO v_request
    FROM music_requests mr
    JOIN profiles p ON mr.user_id = p.id
    WHERE mr.id = p_request_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Request not found');
    END IF;
    
    -- Loop through mentions and create notifications
    FOR v_mention IN SELECT jsonb_array_elements_text(v_request.mentions)
    LOOP
        -- Get user ID from username
        SELECT id INTO v_mentioned_user_id
        FROM profiles
        WHERE LOWER(username) = LOWER(v_mention);
        
        IF v_mentioned_user_id IS NOT NULL AND v_mentioned_user_id != v_request.user_id THEN
            -- Create notification
            INSERT INTO notifications (user_id, type, title, message, data)
            VALUES (
                v_mentioned_user_id,
                'radio_mention',
                '🎵 ' || v_request.requester_name || ' mention kamu di Radio!',
                v_request.requester_name || ' request lagu "' || v_request.song_title || '" dan mention kamu dalam pesannya!',
                jsonb_build_object(
                    'request_id', v_request.id,
                    'song_title', v_request.song_title,
                    'artist_name', v_request.artist_name,
                    'message', v_request.message,
                    'requester_id', v_request.user_id,
                    'requester_name', v_request.requester_name
                )
            );
            
            v_notification_count := v_notification_count + 1;
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'notifications_created', v_notification_count
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_username text;
  next_id_num integer;
  next_jdk_id text;
begin
  -- A. Generate Username
  new_username := new.raw_user_meta_data->>'username';
  if new_username is null then
    new_username := split_part(new.email, '@', 1);
  end if;
  -- Append numbers if duplicate
  while exists (select 1 from public.profiles where username = new_username) loop
    new_username := split_part(new.email, '@', 1) || (floor(random() * 9000 + 1000)::int)::text;
  end loop;

  -- B. Generate JDK ID (JDK0001)
  -- Uses regex to safely find max number, defaults to 0 if table empty
  select coalesce(max(cast(substring(jdk_id from '^JDK([0-9]+)$') as integer)), 0) + 1 
  into next_id_num 
  from public.profiles;

  next_jdk_id := 'JDK' || lpad(next_id_num::text, 4, '0');

  -- C. Insert Profile
  insert into public.profiles (
    id, username, full_name, avatar_url, email, current_points, xp, user_level, jdk_id
  )
  values (
    new.id, 
    new_username, 
    coalesce(new.raw_user_meta_data->>'full_name', new_username), -- Fallback if null
    new.raw_user_meta_data->>'avatar_url', 
    new.email, 
    0, 
    0, 
    'Member', 
    next_jdk_id
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_daily_login()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  last_login timestamp;
  bonus_amount int := 10;
  new_total int;
begin
  -- Check last login bonus
  select created_at into last_login
  from public.points_history
  where user_id = auth.uid() 
  and reason = 'daily_login'
  order by created_at desc
  limit 1;
  -- If last login was less than 20 hours ago, return error
  if last_login > now() - interval '20 hours' then
    return json_build_object('success', false, 'message', 'Already claimed today');
  end if;
  -- Insert history
  insert into public.points_history (user_id, points_change, reason)
  values (auth.uid(), bonus_amount, 'daily_login');
  -- Update profile
  update public.profiles
  set current_points = current_points + bonus_amount,
      -- Simple level up logic: 1 level per 1000 points
      level = floor((current_points + bonus_amount) / 1000) + 1
  where id = auth.uid()
  returning current_points into new_total;
  return json_build_object('success', true, 'points', new_total, 'added', bonus_amount);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_user_account(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- Optional: Verify the caller is an admin (uncomment if you have a way to check)
  -- if not exists (select 1 from public.profiles where id = auth.uid() and user_level = 'Admin') then
  --   raise exception 'Unauthorized';
  -- end if;

  -- Delete from auth.users (Cascades to profiles automatically)
  delete from auth.users where id = target_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_user_level_protection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    BEGIN
        IF auth.role() = 'service_role' THEN
            RETURN NEW;
        END IF;

        IF NEW.user_level IS DISTINCT FROM OLD.user_level THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.admin_permissions
                WHERE user_id = auth.uid() AND is_super_admin = true
            ) THEN
                RAISE EXCEPTION 'Keamanan: Anda tidak diizinkan mengubah User
  Level (Privilege Escalation Blocked).';
            END IF;
        END IF;

        RETURN NEW;
    END;
    $function$
;

CREATE OR REPLACE FUNCTION public.protect_user_level_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- 1. Bypass check if executed by service_role (Edge Functions)
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- 2. Check super admin credentials for standard user REST API clients
    IF NEW.user_level IS DISTINCT FROM OLD.user_level THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.admin_permissions 
            WHERE user_id = auth.uid() AND is_super_admin = true
        ) THEN
            RAISE EXCEPTION 'Keamanan: Anda tidak diizinkan mengubah User Level (Privilege Escalation Blocked).';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$
;

-- ------------------------------------------------------------
-- B. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_duels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jdk_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hero_sliders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_play_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.level_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duel_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duel_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_play_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sticker_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticker_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rekber_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rekber_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adventures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adventure_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Update All, User Update Self" ON public.profiles FOR UPDATE TO authenticated USING (((auth.uid() = id) OR (( SELECT profiles_1.user_level
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid())) = 'Admin'::text)));

CREATE POLICY "Admins can delete any profile" ON public.profiles FOR DELETE USING ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can insert any profile" ON public.profiles FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (is_admin());

CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can update confirmation status" ON public.profiles FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (is_admin());

CREATE POLICY "Allow admin to delete profiles" ON public.profiles FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.user_level = 'Admin'::text)))));

CREATE POLICY "Allow public referral code check" ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Public Profile Email View" ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Public can view social profile data" ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));

CREATE POLICY "Users can insert their own profile." ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));

CREATE POLICY "Users can see own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));

CREATE POLICY "Users can update own non-sensitive profile data" ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK (((auth.uid() = id) AND ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.user_level = 'Admin'::text)))) OR ((user_level <> 'Admin'::text) OR (( SELECT profiles_1.user_level
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid())) = 'Admin'::text)))));

CREATE POLICY "Users can view own full profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));

CREATE POLICY profiles_update_safe_fields_only ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));

CREATE POLICY "Challenger can create duel" ON public.lobby_duels FOR INSERT WITH CHECK ((auth.uid() = challenger_id));

CREATE POLICY "Players can update their moves" ON public.lobby_duels FOR UPDATE USING (((auth.uid() = challenger_id) OR (auth.uid() = challenged_id)));

CREATE POLICY "Public read duels" ON public.lobby_duels FOR SELECT USING (true);

CREATE POLICY "Service role can insert transaction logs" ON public.transaction_log FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));

CREATE POLICY "Users can view own transaction logs" ON public.transaction_log FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Users can delete own notifications" ON public.jdk_notifications FOR DELETE TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Users can update own notifications" ON public.jdk_notifications FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Users can view own notifications" ON public.jdk_notifications FOR SELECT TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Items viewable by everyone" ON public.marketplace_items FOR SELECT USING (true);

CREATE POLICY "Users can insert own items" ON public.marketplace_items FOR INSERT WITH CHECK ((auth.uid() = seller_id));

CREATE POLICY "Users can update own items" ON public.marketplace_items FOR UPDATE USING ((auth.uid() = seller_id));

CREATE POLICY "Admins can manage ranks" ON public.ranks FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Public can view ranks" ON public.ranks FOR SELECT USING (true);

CREATE POLICY "Admins have full access to hero_sliders" ON public.hero_sliders FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.user_level = 'Admin'::text) OR (profiles.user_level = 'Superadmin'::text))))));

CREATE POLICY "Public Read Sliders" ON public.hero_sliders FOR SELECT USING (true);

CREATE POLICY "Public can view active slides" ON public.hero_sliders FOR SELECT USING (((is_active = true) AND (start_date <= now()) AND (end_date >= now())));

CREATE POLICY "Service Role Manage Sliders" ON public.hero_sliders FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Users can manage their own read status" ON public.notification_reads FOR ALL USING ((auth.uid() = user_id));

CREATE POLICY "Admin Modify Games" ON public.games FOR ALL USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "Public Read Games" ON public.games FOR SELECT USING (true);

CREATE POLICY "Service Role Manage Games" ON public.games FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY games_delete_service_only ON public.games FOR DELETE USING (false);

CREATE POLICY games_insert_service_only ON public.games FOR INSERT WITH CHECK (false);

CREATE POLICY games_select_all ON public.games FOR SELECT USING (true);

CREATE POLICY games_update_service_only ON public.games FOR UPDATE USING (false);

CREATE POLICY "Admins can view own permissions" ON public.admin_permissions FOR SELECT USING ((user_id = auth.uid()));

CREATE POLICY "Super Admins ONLY can grant permissions" ON public.admin_permissions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM admin_permissions admin_permissions_1
  WHERE ((admin_permissions_1.user_id = auth.uid()) AND (admin_permissions_1.is_super_admin = true)))));

CREATE POLICY "Super admins can manage all permissions" ON public.admin_permissions FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY "Admins can view all requests" ON public.music_requests FOR SELECT USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = ANY (ARRAY['admin'::text, 'superadmin'::text]))))));

CREATE POLICY "Service role full access" ON public.music_requests FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Users can view own requests" ON public.music_requests FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Admins manage user unlocks" ON public.user_achievements FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Users can see their own achievements" ON public.user_achievements FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Allow public delete" ON public.tournaments FOR DELETE USING (true);

CREATE POLICY "Allow public insert" ON public.tournaments FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read access" ON public.tournaments FOR SELECT USING (true);

CREATE POLICY "Allow public update" ON public.tournaments FOR UPDATE USING (true);

CREATE POLICY "Anyone can view lobby messages" ON public.lobby_messages FOR SELECT USING (true);

CREATE POLICY "Authenticated users can send messages" ON public.lobby_messages FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can delete their own messages" ON public.lobby_messages FOR DELETE USING (((auth.uid() = user_id) OR (( SELECT profiles.user_level
   FROM profiles
  WHERE (profiles.id = auth.uid())) = 'Admin'::text)));

CREATE POLICY "Admins can manage stickers" ON public.stickers FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Anyone can view stickers" ON public.stickers FOR SELECT USING (true);

CREATE POLICY "Public Read Stickers" ON public.stickers FOR SELECT USING (true);

CREATE POLICY "Service Role Manage Stickers" ON public.stickers FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Anyone can view lobby reactions" ON public.lobby_reactions FOR SELECT USING (true);

CREATE POLICY "Authenticated users can react" ON public.lobby_reactions FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Public Read Reactions" ON public.lobby_reactions FOR SELECT USING (true);

CREATE POLICY "Users Can React" ON public.lobby_reactions FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users Can Remove Reaction" ON public.lobby_reactions FOR DELETE TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Users can remove their own reactions" ON public.lobby_reactions FOR DELETE USING ((auth.uid() = user_id));

CREATE POLICY "Admins can view all play history" ON public.game_play_history FOR SELECT USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Enable all access for authenticated users" ON public.game_play_history FOR ALL USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Enable delete for admins" ON public.game_play_history FOR DELETE USING (is_admin());

CREATE POLICY "Users can upsert own play history" ON public.game_play_history FOR ALL USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can view own play history" ON public.game_play_history FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Users modify own history" ON public.game_play_history FOR ALL USING ((auth.uid() = user_id));

CREATE POLICY game_history_select_own ON public.game_play_history FOR SELECT TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Admin point_transactions full access" ON public.point_transactions FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can do everything on point_transactions" ON public.point_transactions FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can manage point transactions" ON public.point_transactions FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can manage point_transactions" ON public.point_transactions FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Enable delete for admins" ON public.point_transactions FOR DELETE USING (is_admin());

CREATE POLICY "Users can insert own point transactions" ON public.point_transactions FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can view own point transactions" ON public.point_transactions FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Users can view own transactions" ON public.point_transactions FOR SELECT TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Users can view their own point history" ON public.point_transactions FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY point_transactions_delete_none ON public.point_transactions FOR DELETE USING (false);

CREATE POLICY point_transactions_insert_service_only ON public.point_transactions FOR INSERT WITH CHECK (false);

CREATE POLICY point_transactions_select_own ON public.point_transactions FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY point_transactions_update_none ON public.point_transactions FOR UPDATE USING (false);

CREATE POLICY "Users can add to wishlist" ON public.wishlist FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can remove from wishlist" ON public.wishlist FOR DELETE USING ((auth.uid() = user_id));

CREATE POLICY "Users can view their own wishlist" ON public.wishlist FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Enable delete for admins" ON public.user_likes FOR DELETE USING (is_admin());

CREATE POLICY "Public read likes" ON public.user_likes FOR SELECT USING (true);

CREATE POLICY "Users can like others" ON public.user_likes FOR INSERT WITH CHECK ((auth.uid() = from_user_id));

CREATE POLICY "Users can unlike" ON public.user_likes FOR DELETE USING ((auth.uid() = from_user_id));

CREATE POLICY "Admins manage leaderboard settings" ON public.leaderboard_settings FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Public Read Leaderboards" ON public.leaderboard_settings FOR SELECT USING (true);

CREATE POLICY "Public read active leaderboard settings" ON public.leaderboard_settings FOR SELECT USING (true);

CREATE POLICY "Service Role Manage Leaderboards" ON public.leaderboard_settings FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Admins can manage level configs" ON public.level_configs FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Allow admin manage level_configs" ON public.level_configs FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.user_level = 'Admin'::text) OR (profiles.user_level = 'superadmin'::text))))));

CREATE POLICY "Allow public read level_configs" ON public.level_configs FOR SELECT USING (true);

CREATE POLICY "Public Read Levels" ON public.level_configs FOR SELECT USING (true);

CREATE POLICY "Public can view level configs" ON public.level_configs FOR SELECT USING (true);

CREATE POLICY "Service Role Manage Levels" ON public.level_configs FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Users can delete messages they received" ON public.messages FOR DELETE USING ((auth.uid() = receiver_id));

CREATE POLICY "Users can delete messages they sent" ON public.messages FOR DELETE USING ((auth.uid() = sender_id));

CREATE POLICY "Users can mark messages they received as read" ON public.messages FOR UPDATE USING ((auth.uid() = receiver_id)) WITH CHECK ((auth.uid() = receiver_id));

CREATE POLICY "Users can send messages" ON public.messages FOR INSERT WITH CHECK ((auth.uid() = sender_id));

CREATE POLICY "Users can view messages they sent or received" ON public.messages FOR SELECT USING (((auth.uid() = sender_id) OR (auth.uid() = receiver_id)));

CREATE POLICY "Anyone can view comments" ON public.event_comments FOR SELECT USING (true);

CREATE POLICY "Authenticated users can post comments" ON public.event_comments FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can delete own comments" ON public.event_comments FOR DELETE USING ((auth.uid() = user_id));

CREATE POLICY "Users can update own comments" ON public.event_comments FOR UPDATE USING ((auth.uid() = user_id));

CREATE POLICY "Anyone can view likes" ON public.comment_likes FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage own likes" ON public.comment_likes FOR ALL USING ((auth.uid() = user_id));

CREATE POLICY "Admins can manage notifications" ON public.notifications FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Anyone can view broadcast notifications" ON public.notifications FOR SELECT USING (((type = 'broadcast'::text) OR (auth.uid() = target_user_id)));

CREATE POLICY "Owners can manage own inventory" ON public.user_inventory FOR ALL USING ((auth.uid() = user_id));

CREATE POLICY "Public read inventory" ON public.user_inventory FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service Role Manage Inventory" ON public.user_inventory FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Users can view their own inventory" ON public.user_inventory FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Users can view their own daily quests" ON public.daily_quests FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Public duel stats are viewable by everyone" ON public.duel_stats FOR SELECT USING (true);

CREATE POLICY "Public achievements are viewable by everyone" ON public.duel_achievements FOR SELECT USING (true);

CREATE POLICY "Admins can view all game logs" ON public.game_play_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Enable delete for admins" ON public.game_play_logs FOR DELETE USING (is_admin());

CREATE POLICY "Users can insert own game logs" ON public.game_play_logs FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY game_logs_select_all ON public.game_play_logs FOR SELECT USING (true);

CREATE POLICY game_play_logs_delete_none ON public.game_play_logs FOR DELETE USING (false);

CREATE POLICY game_play_logs_insert_service_only ON public.game_play_logs FOR INSERT WITH CHECK (false);

CREATE POLICY game_play_logs_select_all ON public.game_play_logs FOR SELECT USING (true);

CREATE POLICY game_play_logs_update_none ON public.game_play_logs FOR UPDATE USING (false);

CREATE POLICY "Enable delete for admins and hosts" ON public.event_hosts FOR DELETE USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Enable insert for admins and hosts" ON public.event_hosts FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Enable read access for all users" ON public.event_hosts FOR SELECT USING (true);

CREATE POLICY "Admins can view email logs" ON public.email_logs FOR SELECT USING (is_admin());

CREATE POLICY "Authenticated users can insert email logs" ON public.email_logs FOR INSERT WITH CHECK (((auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text)));

CREATE POLICY "Admins can manage queue" ON public.music_queue FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = ANY (ARRAY['Admin'::text, 'admin'::text]))))));

CREATE POLICY "Anyone can view queue" ON public.music_queue FOR SELECT USING (true);

CREATE POLICY "Service role full access" ON public.music_queue FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Admins can manage user sticker packs" ON public.user_sticker_packs FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Users can view own packs" ON public.user_sticker_packs FOR SELECT TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Users can view their own sticker packs" ON public.user_sticker_packs FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Admins can do everything on xp_transactions" ON public.xp_transactions FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can manage xp transactions" ON public.xp_transactions FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can manage xp_transactions" ON public.xp_transactions FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Enable delete for admins" ON public.xp_transactions FOR DELETE USING (is_admin());

CREATE POLICY "Users can insert own XP transactions" ON public.xp_transactions FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can view own xp transactions" ON public.xp_transactions FOR SELECT TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY xp_transactions_delete_none ON public.xp_transactions FOR DELETE USING (false);

CREATE POLICY xp_transactions_insert_service_only ON public.xp_transactions FOR INSERT WITH CHECK (false);

CREATE POLICY xp_transactions_select_own ON public.xp_transactions FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY xp_transactions_update_none ON public.xp_transactions FOR UPDATE USING (false);

CREATE POLICY "Admins can manage sticker packs" ON public.sticker_packs FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Public Read Sticker Packs" ON public.sticker_packs FOR SELECT USING (true);

CREATE POLICY "Public can view sticker packs" ON public.sticker_packs FOR SELECT USING (true);

CREATE POLICY "Service Role Manage Packs" ON public.sticker_packs FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Admins can view security logs" ON public.security_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can view security report" ON public.security_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Service can insert logs" ON public.security_logs FOR INSERT WITH CHECK (((auth.jwt() ->> 'role'::text) = 'service_role'::text));

CREATE POLICY "Service role full access" ON public.game_sessions FOR ALL USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text));

CREATE POLICY "Users can view own sessions" ON public.game_sessions FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Anyone can view game comments" ON public.game_comments FOR SELECT USING (true);

CREATE POLICY "Authenticated users can post game comments" ON public.game_comments FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can delete own game comments" ON public.game_comments FOR DELETE USING ((auth.uid() = user_id));

CREATE POLICY "Users can update own game comments" ON public.game_comments FOR UPDATE USING ((auth.uid() = user_id));

CREATE POLICY "Anyone can view game comment likes" ON public.game_comment_likes FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage own game comment likes" ON public.game_comment_likes FOR ALL USING ((auth.uid() = user_id));

CREATE POLICY rekber_buyer_insert ON public.rekber_transactions FOR INSERT WITH CHECK ((auth.uid() = buyer_id));

CREATE POLICY rekber_read_policy ON public.rekber_transactions FOR SELECT USING (((auth.uid() = buyer_id) OR (auth.uid() = seller_id) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text))))));

CREATE POLICY rekber_update_policy ON public.rekber_transactions FOR UPDATE USING (((auth.uid() = buyer_id) OR (auth.uid() = seller_id) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text))))));

CREATE POLICY rekber_msg_insert ON public.rekber_messages FOR INSERT WITH CHECK (((auth.uid() = sender_id) AND (EXISTS ( SELECT 1
   FROM rekber_transactions
  WHERE ((rekber_transactions.id = rekber_messages.transaction_id) AND ((rekber_transactions.buyer_id = auth.uid()) OR (rekber_transactions.seller_id = auth.uid())))))));

CREATE POLICY rekber_msg_read ON public.rekber_messages FOR SELECT USING (((EXISTS ( SELECT 1
   FROM rekber_transactions
  WHERE ((rekber_transactions.id = rekber_messages.transaction_id) AND ((rekber_transactions.buyer_id = auth.uid()) OR (rekber_transactions.seller_id = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text))))));

CREATE POLICY "Users can insert own adventures" ON public.adventures FOR INSERT WITH CHECK (((auth.uid())::text = (member_id)::text));

CREATE POLICY "Users can update own adventures" ON public.adventures FOR UPDATE USING (((auth.uid())::text = (member_id)::text)) WITH CHECK (((auth.uid())::text = (member_id)::text));

CREATE POLICY "Users can view own adventures" ON public.adventures FOR SELECT USING (((auth.uid())::text = (member_id)::text));

CREATE POLICY "Users can insert own scenes" ON public.adventure_scenes FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM adventures
  WHERE ((adventures.id = adventure_scenes.adventure_id) AND ((adventures.member_id)::text = (auth.uid())::text)))));

CREATE POLICY "Users can view own scenes" ON public.adventure_scenes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM adventures
  WHERE ((adventures.id = adventure_scenes.adventure_id) AND ((adventures.member_id)::text = (auth.uid())::text)))));

CREATE POLICY "Admins can do everything on coin_transactions" ON public.coin_transactions FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can insert coin history" ON public.coin_transactions FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "Admins can see all coin history" ON public.coin_transactions FOR SELECT USING (is_admin());

CREATE POLICY "Users can insert own coin transactions" ON public.coin_transactions FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can see own coin history" ON public.coin_transactions FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Users can view their own transactions" ON public.coin_transactions FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY coin_transactions_delete_none ON public.coin_transactions FOR DELETE USING (false);

CREATE POLICY coin_transactions_insert_service_only ON public.coin_transactions FOR INSERT WITH CHECK (false);

CREATE POLICY coin_transactions_select_own ON public.coin_transactions FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY coin_transactions_update_none ON public.coin_transactions FOR UPDATE USING (false);

CREATE POLICY "Admins can manage all registrations" ON public.event_registrations FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can manage registrations" ON public.event_registrations FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Enable delete for admins" ON public.event_registrations FOR DELETE USING (is_admin());

CREATE POLICY "Host can update registrations for their events" ON public.event_registrations FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM events
  WHERE ((events.id = event_registrations.event_id) AND (events.host_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM events
  WHERE ((events.id = event_registrations.event_id) AND (events.host_id = auth.uid())))));

CREATE POLICY "Host can view registrations for their events" ON public.event_registrations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM events
  WHERE ((events.id = event_registrations.event_id) AND (events.host_id = auth.uid())))));

CREATE POLICY "Users can register for events" ON public.event_registrations FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can register themselves" ON public.event_registrations FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can see their own registrations" ON public.event_registrations FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Users can view own registrations" ON public.event_registrations FOR SELECT TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Admins can delete any comment" ON public.photo_comments FOR DELETE USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Public can view comments" ON public.photo_comments FOR SELECT USING (true);

CREATE POLICY "Users can create comments" ON public.photo_comments FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Users can delete own comments" ON public.photo_comments FOR DELETE USING ((user_id = auth.uid()));

CREATE POLICY "Users can update own comments" ON public.photo_comments FOR UPDATE USING ((auth.uid() = ( SELECT photo_comments.user_id
   FROM profiles
  WHERE (profiles.id = photo_comments.user_id))));

CREATE POLICY "Public can view likes" ON public.photo_likes FOR SELECT USING (true);

CREATE POLICY "Users can delete likes" ON public.photo_likes FOR DELETE USING ((auth.uid() = user_id));

CREATE POLICY "Users can insert likes" ON public.photo_likes FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Allow admins to manage events" ON public.events FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Allow public read access to events" ON public.events FOR SELECT USING (true);

CREATE POLICY "Events viewable by everyone" ON public.events FOR SELECT USING (true);

CREATE POLICY "Admins can delete photos" ON public.photo_discussions FOR DELETE USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can insert photos" ON public.photo_discussions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Admins can update photos" ON public.photo_discussions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Public can view visible photo discussions" ON public.photo_discussions FOR SELECT USING (((is_hidden = false) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text))))));

CREATE POLICY "Allow admin update only" ON public.system_settings FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.user_level = 'Admin'::text) OR (profiles.user_level = 'Super Admin'::text))))));

CREATE POLICY "Allow admin update system_settings" ON public.system_settings FOR UPDATE USING ((( SELECT profiles.user_level
   FROM profiles
  WHERE (profiles.id = auth.uid())) = 'Admin'::text));

CREATE POLICY "Allow public read access" ON public.system_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow public read system_settings" ON public.system_settings FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users" ON public.system_settings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable read access for all users" ON public.system_settings FOR SELECT USING (true);

CREATE POLICY "Enable update for authenticated users" ON public.system_settings FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Public Read Settings" ON public.system_settings FOR SELECT USING (true);

CREATE POLICY "Service Role Manage Settings" ON public.system_settings FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Admins manage achievements" ON public.achievements FOR ALL USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = 'Admin'::text)))));

CREATE POLICY "Allow public read achievements" ON public.achievements FOR SELECT USING (true);

CREATE POLICY "Public Read Achievements" ON public.achievements FOR SELECT USING (true);

CREATE POLICY "Service Role Manage Achievements" ON public.achievements FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Admins can delete any product" ON public.products FOR DELETE USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = ANY (ARRAY['Admin'::text, 'Superadmin'::text]))))));

CREATE POLICY "Admins can update any product" ON public.products FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.user_level = ANY (ARRAY['Admin'::text, 'Superadmin'::text]))))));

CREATE POLICY "Products are viewable by everyone" ON public.products FOR SELECT USING (true);

CREATE POLICY "Public Read Products" ON public.products FOR SELECT USING (true);

CREATE POLICY "Service Role Manage Products" ON public.products FOR ALL USING ((auth.role() = 'service_role'::text));

CREATE POLICY "Users Can Delete Own Products" ON public.products FOR DELETE TO authenticated USING ((auth.uid() = seller_id));

CREATE POLICY "Users Can Update Own Products" ON public.products FOR UPDATE TO authenticated USING ((auth.uid() = seller_id));

CREATE POLICY "Users Can Upload Products" ON public.products FOR INSERT TO authenticated WITH CHECK ((auth.uid() = seller_id));

CREATE POLICY "Users can delete their own products" ON public.products FOR DELETE USING ((auth.uid() = seller_id));

CREATE POLICY "Users can insert their own products" ON public.products FOR INSERT WITH CHECK ((auth.uid() = seller_id));

CREATE POLICY "Users can update their own products" ON public.products FOR UPDATE USING ((auth.uid() = seller_id));

-- ------------------------------------------------------------
-- C. CUSTOM TRIGGERS
-- ------------------------------------------------------------

CREATE TRIGGER on_manual_confirm_sync AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION sync_manual_confirmation();

CREATE TRIGGER tr_sync_referral_with_jdkid BEFORE INSERT OR UPDATE OF jdk_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION sync_referral_with_jdkid();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_game_announcer AFTER INSERT ON public.game_play_logs FOR EACH ROW EXECUTE FUNCTION announce_high_score();

CREATE TRIGGER tr_notify_duel_challenge AFTER INSERT ON public.lobby_duels FOR EACH ROW EXECUTE FUNCTION notify_duel_challenge();

CREATE TRIGGER tr_update_duel_stats AFTER UPDATE ON public.lobby_duels FOR EACH ROW EXECUTE FUNCTION update_duel_stats_on_complete();

CREATE TRIGGER update_rekber_transactions_updated_at BEFORE UPDATE ON public.rekber_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_cleanup_lobby_messages AFTER INSERT ON public.lobby_messages FOR EACH STATEMENT EXECUTE FUNCTION delete_old_lobby_messages();

CREATE TRIGGER trigger_prevent_balance_tampering BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_balance_tampering();

CREATE TRIGGER tr_global_xss_protection BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION fn_global_xss_guard();

CREATE TRIGGER update_tournaments_updated_at BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_update_event_quota AFTER INSERT OR DELETE OR UPDATE ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION update_event_quota();

CREATE TRIGGER on_event_attendance_confirmed BEFORE UPDATE ON public.event_registrations FOR EACH ROW WHEN (((new.status = 'attended'::text) AND ((old.status IS NULL) OR (old.status <> 'attended'::text)))) EXECUTE FUNCTION handle_event_attendance_reward();

CREATE TRIGGER update_adventures_updated_at BEFORE UPDATE ON public.adventures FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_protect_user_level_escalation BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_user_level_escalation();

