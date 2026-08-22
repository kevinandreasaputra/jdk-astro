-- ============================================================
-- JADUL KEKINIAN (JDK) - DATABASE SCHEMA DUMP
-- Compatible with Supabase PostgreSQL
-- Generated on: 2026-08-21
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create custom types if they do not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rekber_status') THEN
        CREATE TYPE rekber_status AS ENUM (
            'REQUESTED', 
            'APPROVED', 
            'VERIFYING', 
            'ON_SHIPPING', 
            'DELIVERED', 
            'FINISHED', 
            'CANCELLED', 
            'DISPUTE'
        );
    END IF;
END$$;

-- ============================================================
-- 1. BASE INDEPENDENT TABLES
-- ============================================================

CREATE TABLE public.system_settings (
  id integer NOT NULL DEFAULT 1,
  xp_per_login integer DEFAULT 10,
  double_xp_start timestamp with time zone,
  double_xp_end timestamp with time zone,
  double_points_start timestamp with time zone,
  double_points_end timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  referrer_reward integer DEFAULT 100,
  referee_reward integer DEFAULT 50,
  points_per_login integer DEFAULT 10,
  updated_at timestamp with time zone DEFAULT now(),
  min_rekber_xp integer DEFAULT 200,
  min_upload_xp integer DEFAULT 200,
  min_sticker_level integer DEFAULT 2,
  radio_point_cost integer DEFAULT 500,
  radio_rate_limit_minutes integer DEFAULT 30,
  auto_approve_products boolean DEFAULT false,
  CONSTRAINT system_settings_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ranks (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  rank_type text NOT NULL,
  name text NOT NULL,
  min_level integer NOT NULL,
  min_xp integer NOT NULL,
  badge_url text,
  color_hex text DEFAULT '#4A5568'::text,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  color text DEFAULT '#888888'::text,
  CONSTRAINT ranks_pkey PRIMARY KEY (id)
);

CREATE TABLE public.achievements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL UNIQUE,
  description text,
  icon_emoji text,
  category text DEFAULT 'General'::text,
  is_hidden boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT achievements_pkey PRIMARY KEY (id)
);

CREATE TABLE public.level_configs (
  level integer NOT NULL,
  min_xp integer NOT NULL,
  bonus_multiplier numeric DEFAULT 1.0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT level_configs_pkey PRIMARY KEY (level)
);

CREATE TABLE public.games (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  name text NOT NULL,
  description text,
  points_reward integer DEFAULT 0,
  xp_reward integer DEFAULT 0,
  image_url text,
  game_url text NOT NULL,
  is_active boolean DEFAULT true,
  creator_name text,
  category text,
  min_level integer DEFAULT 0,
  coin_cost integer DEFAULT 0,
  config jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT games_pkey PRIMARY KEY (id)
);

CREATE TABLE public.hero_sliders (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  image_url text NOT NULL,
  link_url text,
  start_date timestamp with time zone NOT NULL,
  end_date timestamp with time zone NOT NULL,
  is_active boolean DEFAULT true,
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  subtitle text,
  mascot_url text,
  CONSTRAINT hero_sliders_pkey PRIMARY KEY (id)
);

CREATE TABLE public.sticker_packs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  thumbnail_url text,
  price integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sticker_packs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.adventures (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  member_id character varying NOT NULL,
  username character varying NOT NULL,
  language character varying DEFAULT 'en'::character varying CHECK (language::text = ANY (ARRAY['en'::character varying, 'id'::character varying, 'ja'::character varying]::text[])),
  started_at timestamp with time zone DEFAULT now(),
  last_played_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT adventures_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tournaments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  bracket_json jsonb NOT NULL,
  config jsonb,
  stage text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tournaments_pkey PRIMARY KEY (id)
);

-- ============================================================
-- 2. USER PROFILE & BASE DEPENDENTS
-- ============================================================

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text UNIQUE CHECK (char_length(username) >= 3),
  full_name text CHECK (full_name !~ '[<>]'::text),
  avatar_url text,
  website text,
  bio text CHECK (bio !~ '[<>]'::text),
  level integer DEFAULT 1,
  current_points integer DEFAULT 0,
  joined_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  birthdate date,
  domicile text,
  user_level text DEFAULT 'Member'::text,
  email text,
  whatsapp text,
  status text DEFAULT 'active'::text,
  last_login timestamp with time zone,
  xp integer DEFAULT 0,
  jdk_id text UNIQUE,
  coin integer DEFAULT 0,
  confirmed_at timestamp with time zone,
  achievements_unlocked integer DEFAULT 0,
  login_streak integer DEFAULT 0,
  last_streak_update timestamp with time zone DEFAULT now(),
  referral_code text UNIQUE,
  referred_by text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);

CREATE TABLE public.admin_permissions (
  user_id uuid NOT NULL,
  permissions text[] DEFAULT '{}'::text[],
  is_super_admin boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT admin_permissions_pkey PRIMARY KEY (user_id),
  CONSTRAINT admin_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

-- ============================================================
-- 3. EVENTS & RELEVANT TABLES
-- ============================================================

CREATE TABLE public.events (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  description text,
  date timestamp with time zone NOT NULL,
  location text,
  image_url text,
  max_participants integer,
  points_reward integer DEFAULT 50,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  google_event_id text,
  price text DEFAULT 'Gratis'::text,
  total_quota integer DEFAULT 50,
  current_quota integer DEFAULT 0,
  time text,
  updated_at timestamp with time zone DEFAULT now(),
  xp_reward integer DEFAULT 0,
  point_reward integer DEFAULT 0,
  reward_achievement_id uuid,
  min_level integer DEFAULT 0,
  point_fee integer DEFAULT 0,
  host_id uuid,
  cert_title text DEFAULT 'CERTIFICATE OF APPRECIATION'::text,
  cert_body text DEFAULT 'Dengan ini menyatakan bahwa [NAME] telah berhasil mengikuti dan menyelesaikan rangkaian kegiatan [EVENT] yang diselenggarakan oleh JDK Entertainment.'::text,
  cert_signer_name text DEFAULT 'JADUL KEKINIAN'::text,
  cert_signer_role text DEFAULT 'Event Coordinator'::text,
  cert_bg_url text,
  gallery_tag text,
  CONSTRAINT events_pkey PRIMARY KEY (id),
  CONSTRAINT events_reward_achievement_id_fkey FOREIGN KEY (reward_achievement_id) REFERENCES public.achievements(id),
  CONSTRAINT events_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.event_hosts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT event_hosts_pkey PRIMARY KEY (id),
  CONSTRAINT event_hosts_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_hosts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.event_registrations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  status text DEFAULT 'registered'::text,
  registered_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  full_name text,
  phone text,
  payment_proof_url text,
  created_at timestamp with time zone DEFAULT now(),
  reward_status text DEFAULT 'pending'::text,
  qr_code text UNIQUE,
  attended_at timestamp with time zone,
  email text,
  CONSTRAINT event_registrations_pkey PRIMARY KEY (id),
  CONSTRAINT event_registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_registrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.event_comments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  event_id uuid,
  user_id uuid,
  parent_id uuid,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT event_comments_pkey PRIMARY KEY (id),
  CONSTRAINT event_comments_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT event_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.event_comments(id)
);

CREATE TABLE public.comment_likes (
  comment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  CONSTRAINT comment_likes_pkey PRIMARY KEY (comment_id, user_id),
  CONSTRAINT comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.event_comments(id),
  CONSTRAINT comment_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

-- ============================================================
-- 4. MARKETPLACE & TRANSACTIONS
-- ============================================================

CREATE TABLE public.marketplace_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  seller_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  price numeric NOT NULL,
  image_url text,
  category text,
  status text DEFAULT 'available'::text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT marketplace_items_pkey PRIMARY KEY (id),
  CONSTRAINT marketplace_items_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.coin_transactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  type text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  admin_id uuid,
  CONSTRAINT coin_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT coin_transactions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.profiles(id),
  CONSTRAINT coin_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.game_play_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  game_id uuid NOT NULL,
  last_played_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_play_history_pkey PRIMARY KEY (id),
  CONSTRAINT game_play_history_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id),
  CONSTRAINT game_play_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.point_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  amount integer NOT NULL,
  type text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT point_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT point_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.user_achievements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  achievement_id uuid,
  unlocked_at timestamp with time zone DEFAULT now(),
  unlocked_reason text,
  CONSTRAINT user_achievements_pkey PRIMARY KEY (id),
  CONSTRAINT user_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_achievements_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.achievements(id)
);

CREATE TABLE public.leaderboard_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  is_active boolean DEFAULT false,
  metric_type text NOT NULL,
  title text NOT NULL,
  start_date date,
  end_date date,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid,
  game_id uuid,
  CONSTRAINT leaderboard_settings_pkey PRIMARY KEY (id),
  CONSTRAINT leaderboard_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id),
  CONSTRAINT leaderboard_settings_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id)
);

CREATE TABLE public.user_likes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_user_id uuid,
  to_user_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_likes_pkey PRIMARY KEY (id),
  CONSTRAINT user_likes_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES auth.users(id),
  CONSTRAINT user_likes_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid,
  name text NOT NULL,
  description text,
  price bigint NOT NULL,
  category text NOT NULL,
  condition text NOT NULL,
  image_url text,
  status text DEFAULT 'available'::text,
  location text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  is_redeemable boolean DEFAULT false,
  redeem_points bigint DEFAULT 0,
  sticker_pack_id uuid,
  gallery text[] DEFAULT '{}'::text[],
  stock integer DEFAULT 1,
  is_unlimited boolean DEFAULT false,
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id),
  CONSTRAINT products_sticker_pack_id_fkey FOREIGN KEY (sticker_pack_id) REFERENCES public.sticker_packs(id)
);

CREATE TABLE public.wishlist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  product_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT wishlist_pkey PRIMARY KEY (id),
  CONSTRAINT wishlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT wishlist_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);

-- ============================================================
-- 5. SOCIAL, GAMING, MESSAGING & OTHER DEPENDENTS
-- ============================================================

CREATE TABLE public.game_play_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  game_id uuid,
  user_id uuid,
  score integer DEFAULT 0,
  played_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_play_logs_pkey PRIMARY KEY (id),
  CONSTRAINT game_play_logs_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id),
  CONSTRAINT game_play_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  content text NOT NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id),
  CONSTRAINT messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  type text DEFAULT 'broadcast'::text,
  target_user_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.profiles(id),
  CONSTRAINT notifications_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);

CREATE TABLE public.notification_reads (
  user_id uuid NOT NULL,
  notification_id uuid NOT NULL,
  read_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_reads_pkey PRIMARY KEY (user_id, notification_id),
  CONSTRAINT notification_reads_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id),
  CONSTRAINT notification_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.stickers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  pack_id uuid,
  CONSTRAINT stickers_pkey PRIMARY KEY (id),
  CONSTRAINT stickers_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.sticker_packs(id)
);

CREATE TABLE public.lobby_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  content text NOT NULL,
  parent_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  type text DEFAULT 'user'::text,
  image_url text,
  CONSTRAINT lobby_messages_pkey PRIMARY KEY (id),
  CONSTRAINT lobby_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT lobby_messages_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.lobby_messages(id)
);

CREATE TABLE public.lobby_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid,
  user_id uuid,
  emoji text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lobby_reactions_pkey PRIMARY KEY (id),
  CONSTRAINT lobby_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.lobby_messages(id),
  CONSTRAINT lobby_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.user_sticker_packs (
  user_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  unlocked_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_sticker_packs_pkey PRIMARY KEY (user_id, pack_id),
  CONSTRAINT user_sticker_packs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_sticker_packs_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.sticker_packs(id)
);

CREATE TABLE public.xp_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  amount integer NOT NULL,
  type text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT xp_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT xp_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.lobby_duels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  challenger_id uuid,
  challenged_id uuid,
  bet_amount integer NOT NULL CHECK (bet_amount >= 0),
  challenger_move text,
  challenged_move text,
  status text DEFAULT 'pending'::text,
  winner_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  challenger_score integer DEFAULT 0,
  challenged_score integer DEFAULT 0,
  rounds jsonb DEFAULT '[]'::jsonb,
  target_score integer DEFAULT 2,
  game_mode text DEFAULT 'Bo3'::text,
  challenger_powerup text,
  challenged_powerup text,
  CONSTRAINT lobby_duels_pkey PRIMARY KEY (id),
  CONSTRAINT lobby_duels_challenger_id_fkey FOREIGN KEY (challenger_id) REFERENCES public.profiles(id),
  CONSTRAINT lobby_duels_challenged_id_fkey FOREIGN KEY (challenged_id) REFERENCES public.profiles(id),
  CONSTRAINT lobby_duels_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.jdk_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  meta_data jsonb DEFAULT '{}'::jsonb,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT jdk_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT jdk_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.duel_stats (
  user_id uuid NOT NULL,
  total_wins integer DEFAULT 0,
  total_losses integer DEFAULT 0,
  total_ties integer DEFAULT 0,
  total_earnings integer DEFAULT 0,
  win_streak integer DEFAULT 0,
  best_streak integer DEFAULT 0,
  rock_count integer DEFAULT 0,
  paper_count integer DEFAULT 0,
  scissors_count integer DEFAULT 0,
  favorite_move text DEFAULT 'none'::text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT duel_stats_pkey PRIMARY KEY (user_id),
  CONSTRAINT duel_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.duel_achievements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  achievement_key text NOT NULL,
  unlocked_at timestamp with time zone DEFAULT now(),
  CONSTRAINT duel_achievements_pkey PRIMARY KEY (id),
  CONSTRAINT duel_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.user_inventory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  item_key text NOT NULL,
  item_name text NOT NULL,
  quantity integer DEFAULT 1,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_inventory_pkey PRIMARY KEY (id),
  CONSTRAINT user_inventory_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.daily_quests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  quest_date date DEFAULT CURRENT_DATE,
  quest_type text NOT NULL,
  target_count integer NOT NULL,
  current_count integer DEFAULT 0,
  is_claimed boolean DEFAULT false,
  reward_points integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT daily_quests_pkey PRIMARY KEY (id),
  CONSTRAINT daily_quests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.game_comments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  game_id uuid,
  user_id uuid,
  parent_id uuid,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_comments_pkey PRIMARY KEY (id),
  CONSTRAINT game_comments_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id),
  CONSTRAINT game_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT game_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.game_comments(id)
);

CREATE TABLE public.game_comment_likes (
  comment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_comment_likes_pkey PRIMARY KEY (comment_id, user_id),
  CONSTRAINT game_comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.game_comments(id),
  CONSTRAINT game_comment_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.rekber_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid,
  buyer_id uuid,
  seller_id uuid,
  amount bigint NOT NULL,
  admin_fee bigint DEFAULT 0,
  status rekber_status DEFAULT 'REQUESTED'::rekber_status,
  shipping_receipt text,
  payment_proof_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT rekber_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT rekber_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT rekber_transactions_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id),
  CONSTRAINT rekber_transactions_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.rekber_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  transaction_id uuid,
  sender_id uuid,
  content text,
  image_url text,
  is_system boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT rekber_messages_pkey PRIMARY KEY (id),
  CONSTRAINT rekber_messages_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.rekber_transactions(id),
  CONSTRAINT rekber_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.music_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  song_title text NOT NULL,
  artist_name text NOT NULL,
  spotify_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'played'::text])),
  points_spent integer NOT NULL DEFAULT 500,
  admin_note text,
  created_at timestamp with time zone DEFAULT now(),
  processed_at timestamp with time zone,
  processed_by uuid,
  message text,
  mentions jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT music_requests_pkey PRIMARY KEY (id),
  CONSTRAINT music_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT music_requests_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.profiles(id)
);

CREATE TABLE public.game_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  game_id text NOT NULL,
  start_time timestamp with time zone NOT NULL DEFAULT now(),
  end_time timestamp with time zone,
  is_used boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text])),
  submitted_score integer,
  duration_seconds integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  violation_type text CHECK (violation_type = ANY (ARRAY['time_mismatch'::text, 'impossible_score'::text, 'session_reuse'::text, 'rate_limit'::text, 'duration_too_short'::text, 'no_session'::text, NULL::text])),
  attempted_score integer,
  CONSTRAINT game_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT game_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.security_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  event_type text NOT NULL,
  game_id text,
  session_id uuid,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  notification_sent boolean DEFAULT false,
  notification_sent_at timestamp with time zone,
  CONSTRAINT security_logs_pkey PRIMARY KEY (id),
  CONSTRAINT security_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.music_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  youtube_url text NOT NULL,
  title text NOT NULL,
  requested_by uuid,
  message text,
  created_at timestamp with time zone DEFAULT now(),
  is_played boolean DEFAULT false,
  played_at timestamp with time zone,
  points_spent integer DEFAULT 500,
  status text DEFAULT 'pending'::text,
  admin_note text,
  processed_at timestamp with time zone,
  processed_by uuid,
  sort_order integer DEFAULT 0,
  CONSTRAINT music_queue_pkey PRIMARY KEY (id),
  CONSTRAINT music_queue_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id),
  CONSTRAINT music_queue_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.profiles(id)
);

CREATE TABLE public.adventure_scenes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  adventure_id uuid NOT NULL,
  scene_number integer NOT NULL,
  story_text text NOT NULL,
  image_url text,
  command text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT adventure_scenes_pkey PRIMARY KEY (id),
  CONSTRAINT adventure_scenes_adventure_id_fkey FOREIGN KEY (adventure_id) REFERENCES public.adventures(id)
);

CREATE TABLE public.email_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  resend_id text,
  status text NOT NULL,
  error_message text,
  meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT email_logs_pkey PRIMARY KEY (id),
  CONSTRAINT email_logs_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.photo_discussions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  event_id uuid,
  photo_url text NOT NULL,
  thumbnail_url text,
  caption text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_hidden boolean DEFAULT false,
  CONSTRAINT photo_discussions_pkey PRIMARY KEY (id),
  CONSTRAINT photo_discussions_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT photo_discussions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

CREATE TABLE public.photo_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  discussion_id uuid,
  parent_id uuid,
  user_id uuid,
  content text NOT NULL,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT photo_comments_pkey PRIMARY KEY (id),
  CONSTRAINT photo_comments_discussion_id_fkey FOREIGN KEY (discussion_id) REFERENCES public.photo_discussions(id),
  CONSTRAINT photo_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.photo_comments(id),
  CONSTRAINT photo_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.photo_likes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  discussion_id uuid,
  user_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT photo_likes_pkey PRIMARY KEY (id),
  CONSTRAINT photo_likes_discussion_id_fkey FOREIGN KEY (discussion_id) REFERENCES public.photo_discussions(id),
  CONSTRAINT photo_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.transaction_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  user_id uuid,
  action text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT transaction_log_pkey PRIMARY KEY (id),
  CONSTRAINT transaction_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
