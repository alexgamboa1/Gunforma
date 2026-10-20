-- Reference data for a fresh Gunforma database: the tables that define
-- rules and categories, and nothing anyone typed in as content.
--
-- Loaded after the migrations by `supabase db reset` and by a Supabase
-- branch. Never applied to production, which already holds these rows.
--
-- Tables (25, plus magazine_housing_fit at the end), in an order that satisfies their foreign keys:
--   platforms, guns, platform_skus, gun_optic_cuts, platform_part_lengths,
--   part_classes, housing_classes, magazine_families
--     — the pistols: what a platform is, which factory models exist, their
--       optic cuts, the slide/barrel lengths a platform registers.
--   calibers, colors, materials, handedness_types, mag_types, basepad_types,
--   clamp_styles, grip_rail_types, rail_types, port_styles, adapter_part_types,
--   optic_cuts, footprints, optic_cut_footprints, rail_bridge
--     — the vocabularies the spec tables and variants are constrained to,
--       and the cut-to-footprint and grip-rail-to-light-rail rule tables.
--   spec_field_rules
--     — what each category requires or allows; create_product(),
--       product_data_status() and the add-a-part page all read it.
--   partners
--     — the retailer list the sync routes feeds by; a product's links need
--       a partner row. Its business columns (commission_pct, tracking_param)
--       are null or placeholders on production.
--
-- Left out on purpose: manufacturers (brands are created by create_product()
-- as needed and are catalogue content), guides (content), and every table
-- that references a product (adapter_parts, light_compatibility,
-- barrel_slide_requirements, magwell_frame_requirements,
-- magazine_frame_requirements, optic_adapter_footprints, product_internal),
-- plus everything a user or admin produced: products, variants, affiliate
-- links, price history, builds, profiles, notifications, link clicks.
--
-- Generated 2026-10-14 from production with
--   pg_dump --data-only --column-inserts --quote-all-identifiers --role postgres -t public.<table> ...
-- (the pg_dump session preamble removed). Regenerate the same way when a
-- reference row changes on production; the file is a copy, not the source.

--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

--
-- Data for Name: adapter_part_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."adapter_part_types" ("part_type", "display_name", "sort_order", "notes") VALUES ('required-adapter', 'Required Adapter', 10, NULL);
INSERT INTO "public"."adapter_part_types" ("part_type", "display_name", "sort_order", "notes") VALUES ('adapter-included', 'Adapter Included', 15, 'Reserved for future use');
INSERT INTO "public"."adapter_part_types" ("part_type", "display_name", "sort_order", "notes") VALUES ('factory-conversion', 'Factory Conversion', 20, NULL);
INSERT INTO "public"."adapter_part_types" ("part_type", "display_name", "sort_order", "notes") VALUES ('aftermarket-upgrade', 'Aftermarket Upgrade', 30, NULL);
INSERT INTO "public"."adapter_part_types" ("part_type", "display_name", "sort_order", "notes") VALUES ('spare', 'Spare', 40, NULL);

--
-- Data for Name: basepad_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."basepad_types" ("basepad_type", "display_name", "sort_order", "notes") VALUES ('flush-replacement', 'Flush Replacement', 10, NULL);
INSERT INTO "public"."basepad_types" ("basepad_type", "display_name", "sort_order", "notes") VALUES ('pinky-extension', 'Pinky Extension', 20, NULL);
INSERT INTO "public"."basepad_types" ("basepad_type", "display_name", "sort_order", "notes") VALUES ('extension', 'Extension', 30, NULL);
INSERT INTO "public"."basepad_types" ("basepad_type", "display_name", "sort_order", "notes") VALUES ('adapter', 'Adapter', 40, NULL);
INSERT INTO "public"."basepad_types" ("basepad_type", "display_name", "sort_order", "notes") VALUES ('completed-mag', 'Completed Magazine', 50, NULL);

--
-- Data for Name: calibers; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."calibers" ("caliber", "display_name", "sort_order", "notes") VALUES ('9mm', '9mm Luger', 10, NULL);

--
-- Data for Name: clamp_styles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."clamp_styles" ("clamp_style", "display_name", "sort_order", "notes") VALUES ('single-key', 'Single Rail Key', 10, 'Ships with one rail key or insert; variant is tied to that rail');
INSERT INTO "public"."clamp_styles" ("clamp_style", "display_name", "sort_order", "notes") VALUES ('multi-key', 'Multiple Rail Keys', 20, 'Ships with several keys or inserts covering more than one rail');
INSERT INTO "public"."clamp_styles" ("clamp_style", "display_name", "sort_order", "notes") VALUES ('multi-plate', 'Multiple Rail Plates', 30, 'Ships with interchangeable mounting plates');
INSERT INTO "public"."clamp_styles" ("clamp_style", "display_name", "sort_order", "notes") VALUES ('rail-grip', 'Rail-Grip Clamp', 40, 'Clamps onto the rail rather than using a key or insert');

--
-- Data for Name: colors; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black', 'Black', 10, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black Distressed', 'Black', 12, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black/Black', 'Black', 14, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black/Blue', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black/Cherry', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black/FDE', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black/Gold', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black/Gray', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black/Hogue', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Black/Red', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gray', 'Gray', 20, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Stealth Gray', 'Gray', 21, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Sniper Gray', 'Gray', 22, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gun Metal Gray', 'Gray', 23, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Tiger Stripe Gray', 'Gray', 24, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Tungsten', 'Gray', 25, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gray/Black', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('FDE', 'Tan/FDE', 30, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Tan', 'Tan/FDE', 31, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Coyote', 'Tan/FDE', 32, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('ODG', 'Green', 40, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Green', 'Green', 41, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Green/Black', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Copper', 'Bronze/Copper', 50, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Bronze', 'Bronze/Copper', 51, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Burnt Bronze', 'Bronze/Copper', 52, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Midnight Bronze', 'Bronze/Copper', 53, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Coyote Bronze', 'Bronze/Copper', 54, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Red Bronze', 'Bronze/Copper', 55, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Bronze/Black', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gold', 'Gold', 60, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gold/Black', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gold/Blue', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gold/Gold', 'Gold', 61, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gold/Gray', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gold/Red', 'Multi', 80, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Silver', 'Silver/Stainless', 70, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Stainless Steel', 'Silver/Stainless', 71, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Satin Stainless Steel', 'Silver/Stainless', 72, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Blue', 'Blue', 75, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Red', 'Red', 76, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Rose Gold', 'Rose', 77, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Rose', 'Rose', 78, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Purple', 'Purple', 79, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Spectrum', 'Multi', 85, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Rainbow', 'Multi', 86, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Hyena/Black', 'Multi', 87, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Clear', 'Clear', 90, NULL);
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('FDE Brown', 'Tan/FDE', 33, 'Streamlight "Flat Dark Earth Brown". Darker than standard FDE.');
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('FDE/Gold', 'Multi', 80, 'Icarus AXG: body coating / grip panel');
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('ODG/Black', 'Multi', 80, 'Icarus AXG: body coating / grip panel');
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gray/Gold', 'Multi', 80, 'Icarus AXG: body coating / grip panel');
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('Gray/Hogue', 'Multi', 80, 'Icarus AXG: body coating / grip panel');
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('ODG/Hogue', 'Multi', 80, 'Icarus AXG: body coating / grip panel');
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('FDE/Hogue', 'Multi', 80, 'Icarus AXG: body coating / grip panel');
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('ODG/Gold', 'Multi', 80, 'Icarus AXG: body coating / grip panel');
INSERT INTO "public"."colors" ("color", "color_family", "sort_order", "notes") VALUES ('FDE/Black', 'Multi', 80, 'Icarus AXG: body coating / grip panel');

--
-- Data for Name: footprints; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('7f029c2e-9551-4a2f-b9c3-81ce51e10a97', 'rmr', 'Trijicon RMR', 'SRO, RMR Type 2, RM06, RCR, RMR HD', 'Trijicon RMR', 'Full-size footprint. Most common on duty/competition guns.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('180aa603-ef67-4bc6-813b-7ab34bca5dee', 'rmrcc', 'Trijicon RMRcc', 'RMRcc, CC06, CC07', 'Trijicon RMRcc', 'Smaller/slimmer than RMR -- NOT interchangeable. CC-specific.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('5557248a-ef8b-41c5-909c-a68798edcb61', 'deltapoint-pro', 'Leupold DeltaPoint Pro', 'DPP', 'Leupold DeltaPoint Pro', 'Wide low-profile window. Unique pattern -- verify slide.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('b29659ce-151b-4a06-ab99-f28cbd724e0a', 'acro-p2', 'Aimpoint ACRO P-2', 'ACRO P-1', 'Aimpoint ACRO', 'Enclosed emitter, sealed. Growing LE/military adoption.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('39988bd0-2de9-48ca-83c9-20b20eb037fa', 'romeo1pro', 'Sig Romeo1 Pro', 'Romeo2 (partial)', 'Sig Sauer Romeo1 Pro', 'Common on P320/P365 family. Sig proprietary.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('67d7a218-3854-41aa-a4e3-ab06f91cd3c1', 'shield-sms', 'Shield SMS / SMS2', 'Shield RMSw', 'Shield Sights SMS', 'UK-made compact. SMS2 adds waterproofing.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('54482662-ea27-4d98-a30e-41b1be808259', 'venom', 'Vortex Venom / Viper', 'Burris Fastfire 3', 'Vortex Venom', 'Budget footprint shared with Burris FF3. Common on aftermarket slides.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('83d85380-fb59-4199-ba1e-0bec1798ddfb', 'c-more', 'C-More STS / RTS2', 'C-More Serendipity, Railway', 'C-More Systems STS', 'Large window, open emitter. Popular in USPSA/IPSC.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('316d0fff-a4d9-4ee3-a8c2-75876dc53368', 'jpoint', 'JPoint / Redfield', 'Redfield Accelerator, Doctor', 'JPoint Optics', 'Older micro footprint, less common on new slides.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('42d2342b-f080-485d-a189-15d8c1b2c004', 'universal', 'Universal', NULL, NULL, 'Only when optic truly fits any standard mount. Rare for pistol RDS.');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('c1b27d63-186a-4287-8ccc-66af0fff47c2', 'glock-mos', 'Glock MOS Direct Mount', NULL, 'Glock', 'Glock factory MOS mounting pattern');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('3f568b00-5d3a-45ea-ae59-1197f5d97395', 'sig-loc-pro', 'SIG-LOC PRO', NULL, 'Sig Sauer Romeo-X SIG-LOC PRO', 'Proprietary SIG locking interface — full-size');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('39408f6e-790e-4fbf-9f5b-417669c956d8', 'sig-loc-compact', 'SIG-LOC Compact', NULL, 'Sig Sauer Romeo-X SIG-LOC Compact', 'Proprietary SIG locking interface — compact');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('171cca76-7668-4f1b-942c-bdd72d564fde', 'sig-loc-mhs', 'SIG-LOC MHS', NULL, 'Sig Sauer Romeo-M17', 'Proprietary SIG locking interface — MHS/M17');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('6c0bdceb-6d24-4174-9a5f-f73f7754569f', '509t', 'Holosun 509T Clamping', NULL, 'Holosun 509T', 'Top-clamping enclosed emitter pattern');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('d83fee57-ae82-4cb2-b838-0360c483b06e', 'aems-micro', 'Holosun AEMS Micro', NULL, 'Holosun AEMS-MICRO', NULL);
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('b9fa0fd7-9b80-4e0c-9365-dd33313f3437', 'acro', 'Aimpoint ACRO', NULL, 'Aimpoint ACRO P-1', 'Aimpoint proprietary footprint');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('9755f5fd-6201-407d-9f76-eb57495e1fd3', 'holosun-k', 'Holosun K-Series / Modified RMSc', 'EPS Carry footprint; Holosun 507K / EPS Carry', 'Holosun 407K/507K', 'RMSc-adjacent but pin spacing differs on some slides');
INSERT INTO "public"."footprints" ("id", "slug", "common_name", "also_known_as", "originating_optic", "notes") VALUES ('b94fda1b-282e-4725-aa59-05b6f6a9d028', 'rmsc', 'Shield RMSc', 'Holosun 407K (stand-alone RMSc); Sig spec-sheet name: COMPACT (Shield RMS-c)', 'Shield Sights RMSc', 'Compact/micro. 507K K-footprint shares this on many slides. | common_name corrected 2026-09-30: was "Trijicon RMSc" — Trijicon never made an RMSc; the pattern is Shield Sights'' RMS-compact (Sig''s own spec field: "COMPACT (Shield RMSc)"). Trijicon''s compact is the RMRcc, a separate footprint row.');

--
-- Data for Name: grip_rail_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."grip_rail_types" ("grip_rail_type", "display_name", "description") VALUES ('picatinny', 'Picatinny', 'Grip module with a Picatinny accessory rail.');
INSERT INTO "public"."grip_rail_types" ("grip_rail_type", "display_name", "description") VALUES ('proprietary', 'Proprietary', 'Manufacturer-specific rail profile, not Picatinny.');
INSERT INTO "public"."grip_rail_types" ("grip_rail_type", "display_name", "description") VALUES ('none', 'No rail', 'Railless grip module. Takes no weapon light.');

--
-- Data for Name: magazine_families; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."magazine_families" ("magazine_family", "display_name", "notes", "capacity_note") VALUES ('micro', 'Micro', 'Original P365 magazine', 'P365 10 and 12 rd');
INSERT INTO "public"."magazine_families" ("magazine_family", "display_name", "notes", "capacity_note") VALUES ('xl', 'XL', 'P365 X / XL magazine', 'P365 X / XL 12, 15 and 17 rd');
INSERT INTO "public"."magazine_families" ("magazine_family", "display_name", "notes", "capacity_note") VALUES ('macro', 'Macro', 'Shared by XMACRO and FUSE despite different housing classes', 'P365 XMACRO / FUSE 17 and 21 rd');
INSERT INTO "public"."magazine_families" ("magazine_family", "display_name", "notes", "capacity_note") VALUES ('p320', 'P320', 'Sig Sauer P320 magazine family. Not interchangeable with P365.', 'P320 15, 17 and 21 rd');

--
-- Data for Name: housing_classes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('p365', 'P365', 'micro', 'standard', 3.1, 3.1, 'Original micro grip');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('p365xl', 'P365 X / XL', 'xl', 'standard', 3.7, 3.1, 'X and XL share one grip. X ships 3.1, XL ships 3.7.');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('fuse', 'P365 FUSE', 'macro', 'extended', 4.3, 4.3, 'Same magazine as XMACRO. Longer grip body runs flush with the 4.3 slide.');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('xmacro', 'P365 XMACRO', 'macro', 'standard', 3.7, 3.7, 'Macro magazine. Runs a 3.7 slide; the COMP and AXG Legion variants are 3.7 slides with a 3.1 barrel behind the comp.');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('p320-compact', 'P320 Compact', 'p320', 'compact', 3.9, 3.6, 'Compact grip module. XCompact and M18 share this grip class.');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('p320-carry', 'P320 Carry', 'p320', 'carry', 3.9, 3.9, 'Carry grip module. XCarry, XCarry Legion, and AXG Legion share this grip class.');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('p320-full', 'P320 Full Size', 'p320', 'full', 4.7, 4.7, 'Full size grip module. Full Size, XFull, and M17 share this grip class.');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('p320-xfive', 'P320 X-Five', 'p320', 'xfive', 5.0, 5.0, 'X-Five grip module. Competition-oriented.');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('fuse-xl', 'P365 FUSE-length (XL mags)', 'xl', 'extended', 4.3, 4.3, 'Aftermarket only (Icarus EVO Series FUSE EVO). FUSE-length grip body that takes X/XL magazines (17/21-rd fit, not flush). Not a direct swap for FUSE owners: MACRO magazines do not fit.');
INSERT INTO "public"."housing_classes" ("housing_class", "display_name", "magazine_family", "grip_length", "typical_slide_length_in", "min_slide_length_in", "notes") VALUES ('xmacro-sub', 'P365 Sub-MACRO (MACRO mags, 3.1in slide)', 'macro', 'standard', 3.1, 3.1, 'Aftermarket only (Icarus MACRO Series Sub MACRO). Takes MACRO 17/21-rd magazines under a standard 3.1in P365 / P365X slide. P365X owners need MACRO magazines.');

--
-- Data for Name: platforms; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."platforms" ("id", "slug", "name", "notes", "make", "description", "image_url", "created_at", "updated_at", "is_live") VALUES ('fa515351-0b60-410b-b5d0-fd78bb714102', 'p365', 'SIG P365', 'The P365 micro-compact family. All parts within the P365 family are mechanically interchangeable (same FCU). Detailed fit (housing class, slide length, barrel length) is handled at the part level.', 'Sig Sauer', NULL, NULL, '2026-07-31 18:31:33.331504+00', '2026-07-31 18:31:33.331504+00', true);
INSERT INTO "public"."platforms" ("id", "slug", "name", "notes", "make", "description", "image_url", "created_at", "updated_at", "is_live") VALUES ('1b678834-c07a-4a94-a994-3b80a86c4235', 'p320', 'SIG P320', 'The P320 modular pistol family. All parts within the P320 family share the same FCU. Grip module fit is determined by housing_class (compact, carry, full, xfive).', 'Sig Sauer', NULL, NULL, '2026-08-01 05:31:29.923271+00', '2026-09-25 22:15:48.165501+00', false);

--
-- Data for Name: guns; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('fede1727-f12d-402b-bf4e-72d14bdb7536', 'p365', 'P365', 'p365', 'Polymer', 3.1, 3.1, '10+1', false, 'Baseline', '2026-07-31 18:31:04.097479+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('11326526-699f-4697-9536-3a17f158fed9', 'p365-x', 'P365 X', 'p365xl', 'Polymer', 3.1, 3.1, '12+1', false, 'XL grip, 3.1 slide', '2026-07-31 18:31:04.097479+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('654473b3-c903-42b0-93fc-88d96b1d6acd', 'p365-xl', 'P365 XL', 'p365xl', 'Polymer', 3.7, 3.7, '12+1', false, 'Same grip as X', '2026-07-31 18:31:04.097479+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('c22105eb-7d03-40e2-a61a-8626ed76cc0c', 'p365-fuse', 'P365 FUSE', 'fuse', 'Polymer', 4.3, 4.3, '21+1', false, 'FUSE grip. Same magazine as XMACRO.', '2026-07-31 18:31:04.097479+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('c442977b-0fba-4841-bd06-2f051e431961', 'p365-axg', 'P365 AXG Legion', 'xmacro', 'Alloy', 3.7, 3.1, '17+1', true, 'XMACRO grip class, ALLOY material.', '2026-07-31 18:31:04.097479+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('52250181-5c05-40b9-b93e-08e50f00bad3', 'p320-full-size', 'P320 Full Size', 'p320-full', 'Polymer', NULL, 4.7, '17+1', false, NULL, '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('f5c5aafa-2161-46b0-87d3-24a761cc8b0b', 'p320-xfull', 'P320 XFull', 'p320-full', 'Polymer', NULL, 4.7, '17+1', false, NULL, '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('896294d9-daec-4888-989b-9ff6e2060be5', 'p320-m17', 'P320 M17', 'p320-full', 'Steel', NULL, 4.7, '17+1', false, 'Military variant', '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('562010bc-179d-4a99-ba24-bf4a6eb9d61c', 'p320-compact', 'P320 Compact', 'p320-compact', 'Polymer', NULL, 3.9, '15+1', false, NULL, '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('553d01ae-89aa-4b78-8144-413821693cbe', 'p320-xcompact', 'P320 XCompact', 'p320-compact', 'Polymer', NULL, 3.6, '15+1', false, NULL, '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('b69083db-3bf8-41b3-9c3d-1b827d52cd02', 'p320-m18', 'P320 M18', 'p320-compact', 'Polymer', NULL, 3.9, '10+1', false, 'Military variant', '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('8260a00e-408a-4f74-a52c-e29157d94323', 'p320-xcarry', 'P320 XCarry', 'p320-carry', 'Polymer', NULL, 3.9, '17+1', false, NULL, '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('29a74d6a-7758-4324-9578-d8c1b2e72c5a', 'p320-xcarry-legion', 'P320 XCarry Legion', 'p320-carry', 'Steel', NULL, 4.6, '17+1', false, NULL, '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('7fc542d4-4bb0-4db8-9d8b-d7803a793cf6', 'p320-axg-legion', 'P320 AXG Legion', 'p320-carry', 'Alloy', NULL, 3.9, '21+1', false, 'Alloy frame', '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('02fd7e6c-7d0b-49a4-a56a-4ce552ca7b2c', 'p320-xfive-legion', 'P320 XFive Legion', 'p320-xfive', 'Steel', NULL, 5.0, '17+1', false, NULL, '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('0d1c5145-8ae1-4bde-be64-704df76c58e1', 'p320-xfive-legion-dh3', 'P320 XFive Legion DH3', 'p320-xfive', 'Steel', NULL, 5.0, '21+1', false, 'DH3 grip', '2026-08-01 05:31:29.923271+00', '2026-09-17 19:46:04.007137+00', '1b678834-c07a-4a94-a994-3b80a86c4235');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('52ce73b1-af25-4445-bb20-5cfb684bd397', 'p365-fuse-comp', 'P365 FUSE Comp', 'fuse', 'Polymer', 4.3, 3.7, '21+1', true, 'FUSE grip. Same magazine as XMACRO.', '2026-08-13 13:55:51.688718+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('f3ec2adf-abef-493b-ba3c-972090b4fd18', 'p365-xmacro', 'P365 XMacro', 'xmacro', 'Polymer', 3.7, 3.7, '17+1', false, 'Tacops are accessory variants, same grip', '2026-07-31 18:31:04.097479+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('1c8e49dd-0c7a-4f94-989e-8ff518459f44', 'p365-xl-rose-comp', 'P365 XL Rose Comp', 'p365xl', 'Polymer', 3.7, 3.1, '12+1', true, 'Integrally compensated slide (internal porting). Same OAL as base XL. Verified from Sig Sauer spec sheet.', '2026-09-07 18:36:16.949674+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('5bbca04c-d997-41c0-bb9c-be80ec7febbf', 'p365-xmacro-comp', 'P365 XMacro Comp', 'xmacro', 'Polymer', 3.7, 3.1, '17+1', true, NULL, '2026-08-13 13:55:51.688718+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('4908b830-0a13-44cd-a570-842a910254c6', 'p365-xf-dh3', 'P365 XF DH3', 'xmacro', 'Polymer', 4.3, 3.7, '17+1', true, 'DH3 barrel + slide-integrated expansion chamber. Coyote polymer XMACRO grip. Same slide/barrel as p365-fuse-comp but XMACRO grip housing.', '2026-09-07 18:36:16.949674+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');
INSERT INTO "public"."guns" ("id", "slug", "name", "housing_class", "frame_material", "slide_length_in", "barrel_length_in", "oem_capacity", "integrated_comp", "notes", "created_at", "updated_at", "platform_id") VALUES ('f6a1c96c-76df-4ad4-8d7b-dff4829371fa', 'p365-xf-dh3-axg', 'P365 XF DH3 AXG', 'xmacro', 'Alloy', 4.3, 3.7, '17+1', true, 'DH3 barrel + AXG aluminum grip. Same barrel/comp as p365-xf-dh3.', '2026-09-07 18:36:16.949674+00', '2026-09-17 19:46:04.007137+00', 'fa515351-0b60-410b-b5d0-fd78bb714102');

--
-- Data for Name: gun_optic_cuts; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('fede1727-f12d-402b-bf4e-72d14bdb7536', 'none', 'legacy-non-optic-ready', 'verified', 'https://www.sigsauer.com/p365-optic-ready.html', 'Older non-optic-ready SKUs; slide must be milled or replaced');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('fede1727-f12d-402b-bf4e-72d14bdb7536', 'sig-loc-compact', 'sku-sl-rxsl', 'verified', 'https://www.sigsauer.com/p365-optic-ready.html', '-SL SKUs, e.g. 365-9-BXR3P-MS-SL-CA');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('fede1727-f12d-402b-bf4e-72d14bdb7536', 'rmsc', 'default', 'verified', 'https://www.sigsauer.com/p365-optic-ready.html', 'Current optic-ready SKUs');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('11326526-699f-4697-9536-3a17f158fed9', 'sig-loc-compact', 'sku-sl-rxsl', 'verified', 'https://www.sigsauer.com/p365x.html', '365X-9-BXR3-RXSL, -RXSL-10');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('11326526-699f-4697-9536-3a17f158fed9', 'rmsc', 'default', 'verified', 'https://www.sigsauer.com/p365x.html', NULL);
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('654473b3-c903-42b0-93fc-88d96b1d6acd', 'rmsc', 'all-current-skus', 'verified', 'https://www.sigsauer.com/p365-xl.html', 'All 6 listed SKUs');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('c22105eb-7d03-40e2-a61a-8626ed76cc0c', 'rmsc', 'sku-rs', 'verified', 'https://www.sigsauer.com/p365-fuse.html', '365XF-9-BFO-RS (ROMEO-RS equipped); live read 2026-09-30');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('c22105eb-7d03-40e2-a61a-8626ed76cc0c', 'sig-loc-compact', 'default', 'verified', 'https://www.sigsauer.com/p365-fuse.html', 'BFO, CFO, -10, -MS, -RXSL; the only model defaulting to SIG-LOC; live read 2026-09-30');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('c442977b-0fba-4841-bd06-2f051e431961', 'sig-loc-compact', 'sku-sl-rxsl', 'verified', 'https://www.sigsauer.com/p365-axg-legion.html', '365AXGCA-9-LEGION-RXSL');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('c442977b-0fba-4841-bd06-2f051e431961', 'rmsc', 'default', 'verified', 'https://www.sigsauer.com/p365-axg-legion.html', NULL);
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('52ce73b1-af25-4445-bb20-5cfb684bd397', 'sig-loc-compact', 'sku-sl-rxsl', 'verified', 'https://www.sigsauer.com/p365-fuse-comp.html', '365XF-9-COMP-RXSL');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('52ce73b1-af25-4445-bb20-5cfb684bd397', 'rmsc', 'default', 'verified', 'https://www.sigsauer.com/p365-fuse-comp.html', NULL);
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('f3ec2adf-abef-493b-ba3c-972090b4fd18', 'sig-loc-compact', 'sku-sl-rxsl', 'verified', 'https://www.sigsauer.com/p365-xmacro-1.html', 'Verified 2026-10-19 (Alex). SIG spec field lists COMPACT (Shield RMSc) for -SL/-RXSL; SIG-LOC Compact confirmed to fit.');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('f3ec2adf-abef-493b-ba3c-972090b4fd18', 'rmsc', 'default', 'verified', 'https://www.sigsauer.com/p365-xmacro-1.html', 'Live per-SKU spec read 2026-09-30');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('1c8e49dd-0c7a-4f94-989e-8ff518459f44', 'sig-loc-compact', 'sku-sl-rxsl', 'verified', 'https://www.sigsauer.com/p365xl-rose-comp-california.html', '365XL-9-ROSE-MS-SL-CA');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('1c8e49dd-0c7a-4f94-989e-8ff518459f44', 'rmsc', 'default', 'verified', 'https://www.sigsauer.com/p365-rose-xl-comp.html', NULL);
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('5bbca04c-d997-41c0-bb9c-be80ec7febbf', 'sig-loc-compact', 'sku-sl-rxsl', 'verified', 'https://www.sigsauer.com/p365-xmacro.html', 'Verified 2026-10-19 (Alex). SIG spec field lists COMPACT (Shield RMSc) for -SL/-RXSL; SIG-LOC Compact confirmed to fit.');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('5bbca04c-d997-41c0-bb9c-be80ec7febbf', 'rmsc', 'default', 'verified', 'https://www.sigsauer.com/p365-xmacro.html', 'Live per-SKU spec read 2026-09-30');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('4908b830-0a13-44cd-a570-842a910254c6', 'sig-loc-compact', 'sku-sl-rxsl', 'verified', 'https://www.sigsauer.com/p365-dh3.html', '365XF-9-DH3-RXSL; live per-SKU spec read 2026-09-30');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('4908b830-0a13-44cd-a570-842a910254c6', 'rmsc', 'default', 'verified', 'https://www.sigsauer.com/p365-dh3.html', '365XF-9-DH3, -10; live per-SKU spec read 2026-09-30');
INSERT INTO "public"."gun_optic_cuts" ("gun_id", "optic_cut", "applies_to", "confidence", "source_url", "notes") VALUES ('f6a1c96c-76df-4ad4-8d7b-dff4829371fa', 'rmsc', 'all-current-skus', 'verified', 'https://www.sigsauer.com/p365-dh3-axg.html', 'Both SKUs; live per-SKU spec read 2026-09-30');

--
-- Data for Name: handedness_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."handedness_types" ("handedness", "display_name", "sort_order", "notes") VALUES ('right', 'Right', 10, NULL);
INSERT INTO "public"."handedness_types" ("handedness", "display_name", "sort_order", "notes") VALUES ('left', 'Left', 20, NULL);
INSERT INTO "public"."handedness_types" ("handedness", "display_name", "sort_order", "notes") VALUES ('ambidextrous', 'Ambidextrous', 30, NULL);

--
-- Data for Name: mag_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."mag_types" ("mag_type", "display_name", "sort_order", "notes") VALUES ('10rd', '10-Round', 10, NULL);
INSERT INTO "public"."mag_types" ("mag_type", "display_name", "sort_order", "notes") VALUES ('15rd', '15-Round', 20, NULL);
INSERT INTO "public"."mag_types" ("mag_type", "display_name", "sort_order", "notes") VALUES ('17rd-xmacro', '17-Round XMACRO', 30, NULL);

--
-- Data for Name: materials; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."materials" ("material_family", "sort_order", "notes") VALUES ('Aluminum', 10, NULL);
INSERT INTO "public"."materials" ("material_family", "sort_order", "notes") VALUES ('Stainless Steel', 20, NULL);
INSERT INTO "public"."materials" ("material_family", "sort_order", "notes") VALUES ('Steel', 30, NULL);
INSERT INTO "public"."materials" ("material_family", "sort_order", "notes") VALUES ('Polymer', 40, NULL);
INSERT INTO "public"."materials" ("material_family", "sort_order", "notes") VALUES ('Titanium', 50, NULL);
INSERT INTO "public"."materials" ("material_family", "sort_order", "notes") VALUES ('Mixed', 90, NULL);
INSERT INTO "public"."materials" ("material_family", "sort_order", "notes") VALUES ('Unspecified', 99, NULL);

--
-- Data for Name: optic_cuts; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('none', 'No cut (un-milled)', 'none', 'No optic pocket. Iron sights only.');
INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('rmsc', 'RMSc', 'direct', 'Most common micro-red-dot cut. RMR-footprint optics need a plate.');
INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('rmr', 'RMR', 'direct', 'RMSc-footprint optics need a plate.');
INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('acro', 'ACRO', 'direct', 'Enclosed-emitter footprint.');
INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('shield', 'Shield RMS', 'direct', NULL);
INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('holosun-k', 'Holosun K', 'direct', 'Shares the RMSc pattern on many slides.');
INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('delta-point', 'DeltaPoint Pro', 'direct', NULL);
INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('ki-multi', 'Killer Innovations Multi-Optic', 'plate-system', 'One cut, many footprints. The plate/shim kit selects the footprint. Individual plates not catalogued yet.');
INSERT INTO "public"."optic_cuts" ("optic_cut", "display_name", "mounting", "notes") VALUES ('sig-loc-compact', 'SIG-LOC Compact', 'direct', 'SIG''s factory SIG-LOC cut (FUSE default; -SL/-RXSL SKUs family-wide). Superset of RMSc: also accepts traditional top-mount reflex sights per SIG FAQ.');

--
-- Data for Name: optic_cut_footprints; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('rmsc', 'b94fda1b-282e-4725-aa59-05b6f6a9d028', 'direct', NULL);
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('rmr', '7f029c2e-9551-4a2f-b9c3-81ce51e10a97', 'direct', NULL);
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('acro', 'b29659ce-151b-4a06-ab99-f28cbd724e0a', 'direct', 'Steiner MPS shares this pattern');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('shield', '67d7a218-3854-41aa-a4e3-ab06f91cd3c1', 'direct', NULL);
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('delta-point', '5557248a-ef8b-41c5-909c-a68798edcb61', 'direct', NULL);
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('ki-multi', 'b94fda1b-282e-4725-aa59-05b6f6a9d028', 'via-plate', 'Selected by cover plate / shim kit');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('ki-multi', '7f029c2e-9551-4a2f-b9c3-81ce51e10a97', 'via-plate', 'Selected by cover plate / shim kit');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('ki-multi', 'b29659ce-151b-4a06-ab99-f28cbd724e0a', 'via-plate', 'Selected by cover plate / shim kit');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('ki-multi', '5557248a-ef8b-41c5-909c-a68798edcb61', 'via-plate', 'Selected by cover plate / shim kit');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('sig-loc-compact', 'b94fda1b-282e-4725-aa59-05b6f6a9d028', 'direct', 'Inherited from rmsc cut per SIG SIG-LOC FAQ 2026-09-30: traditional top-mount reflex sights compatible with SIG-LOC slides');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('sig-loc-compact', '39408f6e-790e-4fbf-9f5b-417669c956d8', 'direct', 'Native SIG-LOC mount, no adapter plate (sigsauer.com/sig-loc)');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('rmsc', '9755f5fd-6201-407d-9f76-eb57495e1fd3', 'direct', 'K-footprint overlaps the RMSc pattern on many slides | Repointed from empty twin footprint holosun-507k, 2026-09-30');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('holosun-k', '9755f5fd-6201-407d-9f76-eb57495e1fd3', 'direct', 'Repointed from empty twin footprint holosun-507k, 2026-09-30');
INSERT INTO "public"."optic_cut_footprints" ("optic_cut", "footprint_id", "fit", "notes") VALUES ('sig-loc-compact', '9755f5fd-6201-407d-9f76-eb57495e1fd3', 'direct', 'Inherited from rmsc cut per SIG SIG-LOC FAQ 2026-09-30: traditional top-mount reflex sights compatible with SIG-LOC slides | Repointed from empty twin footprint holosun-507k, 2026-09-30');

--
-- Data for Name: part_classes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."part_classes" ("part_class", "display_name", "sort_order", "notes") VALUES ('p365', 'P365', 10, NULL);
INSERT INTO "public"."part_classes" ("part_class", "display_name", "sort_order", "notes") VALUES ('xl', 'P365 X / XL', 20, NULL);
INSERT INTO "public"."part_classes" ("part_class", "display_name", "sort_order", "notes") VALUES ('xmacro', 'P365 XMACRO', 30, 'No slides or barrels use this yet');
INSERT INTO "public"."part_classes" ("part_class", "display_name", "sort_order", "notes") VALUES ('fuse', 'P365 FUSE', 40, NULL);

--
-- Data for Name: partners; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."partners" ("id", "slug", "name", "base_url", "commission_pct", "tracking_param", "notes", "created_at", "updated_at", "awin_merchant_id") VALUES ('8c09c765-0220-4f6c-9569-2f2c5cdd974b', 'partner-one', 'Partner One', NULL, NULL, 'ref', 'Placeholder from the reference workbook', '2026-07-30 05:38:19.526685+00', '2026-07-30 05:38:19.526685+00', NULL);
INSERT INTO "public"."partners" ("id", "slug", "name", "base_url", "commission_pct", "tracking_param", "notes", "created_at", "updated_at", "awin_merchant_id") VALUES ('41e2ec02-f006-416b-bf86-8ac7074f1fb9', 'optics-planet', 'OpticsPlanet', NULL, NULL, NULL, 'Referenced by barrel affiliate rows', '2026-07-30 05:38:19.526685+00', '2026-07-30 05:38:19.526685+00', NULL);
INSERT INTO "public"."partners" ("id", "slug", "name", "base_url", "commission_pct", "tracking_param", "notes", "created_at", "updated_at", "awin_merchant_id") VALUES ('129a9808-91b6-42b9-8e80-55cea9af5600', 'amazon', 'Amazon', NULL, NULL, NULL, 'Referenced by GF_Lights affiliate rows. Not present in the shared reference partners tab.', '2026-07-30 14:58:05.865933+00', '2026-07-30 14:58:05.865933+00', NULL);
INSERT INTO "public"."partners" ("id", "slug", "name", "base_url", "commission_pct", "tracking_param", "notes", "created_at", "updated_at", "awin_merchant_id") VALUES ('b7a1c489-04c2-441f-bb60-b2c41acde26c', 'awin-optics-planet', 'OpticsPlanet (Awin)', NULL, NULL, NULL, 'AWIN merchant id 46059. Confirmed 2026-09-05: separate advertiser from Olight (Awin) -- do not merge.', '2026-07-30 05:38:19.526685+00', '2026-09-05 05:40:59.190642+00', '46059');
INSERT INTO "public"."partners" ("id", "slug", "name", "base_url", "commission_pct", "tracking_param", "notes", "created_at", "updated_at", "awin_merchant_id") VALUES ('287dcc5f-d189-4a1f-a8aa-85dac01d18da', 'awin-olight', 'Olight (Awin)', 'https://www.olight.com', NULL, NULL, 'AWIN merchant id 90861. Confirmed 2026-09-05: separate advertiser from OpticsPlanet (Awin), not the same retailer -- do not merge.', '2026-09-05 05:22:03.343082+00', '2026-09-05 05:40:59.190642+00', '90861');

--
-- Data for Name: platform_part_lengths; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."platform_part_lengths" ("platform_id", "part_kind", "length_in", "part_class", "notes") VALUES ('fa515351-0b60-410b-b5d0-fd78bb714102', 'slide', 3.10, 'p365', NULL);
INSERT INTO "public"."platform_part_lengths" ("platform_id", "part_kind", "length_in", "part_class", "notes") VALUES ('fa515351-0b60-410b-b5d0-fd78bb714102', 'barrel', 3.10, 'p365', NULL);
INSERT INTO "public"."platform_part_lengths" ("platform_id", "part_kind", "length_in", "part_class", "notes") VALUES ('fa515351-0b60-410b-b5d0-fd78bb714102', 'slide', 3.70, 'xl', NULL);
INSERT INTO "public"."platform_part_lengths" ("platform_id", "part_kind", "length_in", "part_class", "notes") VALUES ('fa515351-0b60-410b-b5d0-fd78bb714102', 'barrel', 3.70, 'xl', NULL);
INSERT INTO "public"."platform_part_lengths" ("platform_id", "part_kind", "length_in", "part_class", "notes") VALUES ('fa515351-0b60-410b-b5d0-fd78bb714102', 'slide', 4.30, 'fuse', NULL);
INSERT INTO "public"."platform_part_lengths" ("platform_id", "part_kind", "length_in", "part_class", "notes") VALUES ('fa515351-0b60-410b-b5d0-fd78bb714102', 'barrel', 4.30, 'fuse', NULL);

--
-- Data for Name: platform_skus; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('fede1727-f12d-402b-bf4e-72d14bdb7536', 'sig-p365');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('11326526-699f-4697-9536-3a17f158fed9', 'sig-p365-x');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('654473b3-c903-42b0-93fc-88d96b1d6acd', 'sig-p365-xl');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('c22105eb-7d03-40e2-a61a-8626ed76cc0c', 'sig-p365-fuse');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('f3ec2adf-abef-493b-ba3c-972090b4fd18', 'sig-p365-xmacro');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('f3ec2adf-abef-493b-ba3c-972090b4fd18', 'sig-p365-xmacro-tacops');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('c442977b-0fba-4841-bd06-2f051e431961', 'sig-p365-axg-legion');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('52ce73b1-af25-4445-bb20-5cfb684bd397', 'sig-p365-fuse-comp');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('5bbca04c-d997-41c0-bb9c-be80ec7febbf', 'sig-p365-xmacro-comp');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('1c8e49dd-0c7a-4f94-989e-8ff518459f44', 'sig-p365-xl-rose-comp');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('4908b830-0a13-44cd-a570-842a910254c6', 'sig-p365-xf-dh3');
INSERT INTO "public"."platform_skus" ("gun_id", "gun_db_platform_id") VALUES ('f6a1c96c-76df-4ad4-8d7b-dff4829371fa', 'sig-p365-xf-dh3-axg');

--
-- Data for Name: port_styles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."port_styles" ("port_style", "display_name", "sort_order", "notes") VALUES ('c-port', 'C-Port', 10, NULL);
INSERT INTO "public"."port_styles" ("port_style", "display_name", "sort_order", "notes") VALUES ('e-port', 'E-Port', 20, NULL);
INSERT INTO "public"."port_styles" ("port_style", "display_name", "sort_order", "notes") VALUES ('slide-matched', 'Slide-Matched', 30, 'Barrel port matches whatever slide it is fitted to');

--
-- Data for Name: rail_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."rail_types" ("rail_type", "display_name", "spec", "description", "example_guns") VALUES ('1913', 'MIL-STD-1913 Picatinny', '~0.206in slot', 'Standard full-size accessory rail. Any 1913 light fits.', 'Sig P320, S&W M&P, Walther PDP, Echelon, Shadow Systems');
INSERT INTO "public"."rail_types" ("rail_type", "display_name", "spec", "description", "example_guns") VALUES ('1913-short', '1913 Short (subcompact)', '~0.206in slot, short', 'Short Picatinny section on subcompacts. Rail LENGTH does not affect light fit -- only the standard does.', 'Sig P365 XMACRO, Hellcat Pro, Shield Plus');
INSERT INTO "public"."rail_types" ("rail_type", "display_name", "spec", "description", "example_guns") VALUES ('gl-uni', 'Glock Universal', 'Glock proprietary', 'Glock full/compact factory rail.', 'Glock 17/19/45/34');
INSERT INTO "public"."rail_types" ("rail_type", "display_name", "spec", "description", "example_guns") VALUES ('glock-slim', 'Glock Slimline', 'Glock proprietary', 'Slimline single-stack rail.', 'Glock 43X/48, Shadow CR920, FN Reflex');
INSERT INTO "public"."rail_types" ("rail_type", "display_name", "spec", "description", "example_guns") VALUES ('sig-365', 'Sig P365 Proprietary', 'SIG proprietary', 'OEM P365 rail footprint -- shorter and narrower than 1913. Lights must be designed or keyed for it.', 'Sig P365 / P365X / P365XL (base grip modules)');
INSERT INTO "public"."rail_types" ("rail_type", "display_name", "spec", "description", "example_guns") VALUES ('sa-hellcat', 'Springfield Hellcat Proprietary', 'SA proprietary', 'Hellcat factory rail.', 'Springfield Hellcat / RDP');
INSERT INTO "public"."rail_types" ("rail_type", "display_name", "spec", "description", "example_guns") VALUES ('sw-tsw', 'S&W 99/TSW', 'S&W proprietary', 'Legacy S&W rail.', 'S&W TSW, 99');
INSERT INTO "public"."rail_types" ("rail_type", "display_name", "spec", "description", "example_guns") VALUES ('ber-90two', 'Beretta 90two', 'Beretta proprietary', '90two proprietary rail.', 'Beretta 90two');

--
-- Data for Name: rail_bridge; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('p365', 'proprietary', 'sig-365', 'verified', 'P365 proprietary rail = SIG-365 light clamp. Base/X.');
INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('p365xl', 'proprietary', 'sig-365', 'verified', 'P365XL proprietary rail = SIG-365 clamp. Same as base/X.');
INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('xmacro', 'proprietary', 'sig-365', 'likely', 'Rare XMacro proprietary-rail SKU (WC XMacro-SG) uses SIG-365 clamp.');
INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('p365', 'picatinny', '1913-short', 'verified', 'Aftermarket P365 pic-rail grip takes short-1913 light clamp.');
INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('p365xl', 'picatinny', '1913-short', 'verified', 'Aftermarket P365XL pic-rail grip takes short-1913 clamp.');
INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('xmacro', 'picatinny', '1913-short', 'verified', 'XMacro factory pic rail = short 1913. NOT the SIG-365 clamp.');
INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('fuse', 'picatinny', '1913-short', 'verified', 'Fuse (XMacro-length) pic rail = short 1913.');
INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('fuse-xl', 'picatinny', '1913-short', 'verified', NULL);
INSERT INTO "public"."rail_bridge" ("grip_housing_class", "grip_rail_type", "light_rail_type", "fit_confidence", "notes") VALUES ('xmacro-sub', 'picatinny', '1913-short', 'verified', NULL);

--
-- Data for Name: spec_field_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'platform', 'required', NULL, NULL, 'Platform', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'slide_length_in', 'required', NULL, NULL, 'Slide length (in)', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'barrel_length_in', 'required', NULL, NULL, 'Barrel length (in)', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'comes_with_sights', 'required', NULL, NULL, 'Comes with sights', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'barrel_included', 'required', NULL, NULL, 'Barrel included', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'window_cuts', 'required', NULL, NULL, 'Window cuts', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'internally_ported', 'required', NULL, NULL, 'Internally ported', 70);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'port_style', 'required', 'internally_ported', '{true}', 'Port style', 80);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'port_count', 'required', 'internally_ported', '{true}', 'Number of ports', 90);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'integrated_comp', 'required', NULL, NULL, 'Integrated compensator', 100);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'threaded_barrel_ok', 'required', NULL, NULL, 'Takes a threaded barrel', 110);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide', 'required_spring_weight', 'required', NULL, NULL, 'Recoil spring weight it needs', 120);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('barrel', 'platform', 'required', NULL, NULL, 'Platform', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('barrel', 'barrel_length_in', 'required', NULL, NULL, 'Barrel length (in)', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('barrel', 'barrel_type', 'required', NULL, NULL, 'Barrel type', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('barrel', 'thread_pitch', 'required', 'barrel_type', '{threaded,threaded-and-ported}', 'Thread pitch', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('barrel', 'port_style', 'required', 'barrel_type', '{ported,threaded-and-ported}', 'Port style', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('barrel', 'caliber', 'required', NULL, NULL, 'Caliber', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('barrel', 'is_lci', 'required', NULL, NULL, 'Loaded-chamber indicator', 70);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('barrel', 'requires_slide_text', 'optional', NULL, NULL, 'Slide it requires', 80);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'housing_class', 'required', NULL, NULL, 'Grip housing class', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'has_rail', 'required', NULL, NULL, 'Has an accessory rail', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'grip_rail_type', 'required', 'has_rail', '{true}', 'Rail type', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'grip_texture', 'required', NULL, NULL, 'Grip texture', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'magwell_type', 'optional', NULL, NULL, 'Magwell type', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'has_beaver_tail', 'optional', NULL, NULL, 'Beavertail', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'undercut_trigger_guard', 'optional', NULL, NULL, 'Undercut trigger guard', 70);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'thumb_rest', 'optional', NULL, NULL, 'Thumb rest', 80);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'thumb_stippling', 'optional', NULL, NULL, 'Thumb stippling', 90);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'includes_hardware', 'optional', NULL, NULL, 'Includes hardware', 100);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('frame', 'hardware_notes', 'optional', NULL, NULL, 'Hardware notes', 110);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'footprint', 'required', NULL, NULL, 'Footprint', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'optic_type', 'required', NULL, NULL, 'Optic type', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'reticle', 'required', NULL, NULL, 'Reticle', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'reticle_type', 'required', NULL, NULL, 'Reticle type', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'selectable_reticle', 'required', NULL, NULL, 'Selectable reticle', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'dot_size_moa', 'optional', NULL, NULL, 'Dot size (MOA)', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'magnification', 'required', NULL, NULL, 'Magnification', 70);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'window_size', 'required', NULL, NULL, 'Window size', 80);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'emitter', 'required', NULL, NULL, 'Emitter', 90);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'enclosed_emitter', 'required', NULL, NULL, 'Enclosed emitter', 100);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'brightness_settings', 'required', NULL, NULL, 'Brightness settings', 110);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'auto_on_off', 'required', NULL, NULL, 'Auto on/off', 120);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'shake_awake', 'required', NULL, NULL, 'Shake awake', 130);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'adjustment_per_click', 'required', NULL, NULL, 'Adjustment per click', 140);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'battery_type', 'required', NULL, NULL, 'Battery type', 150);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'battery_location', 'required', NULL, NULL, 'Battery location', 160);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'removable_battery', 'required', NULL, NULL, 'Removable battery', 170);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'battery_life', 'required', NULL, NULL, 'Battery life', 180);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'solar_power', 'required', NULL, NULL, 'Solar power', 190);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('optic', 'housing_material', 'required', NULL, NULL, 'Housing material (filled from the product''s material)', 200);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'series', 'required', NULL, NULL, 'Series', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'config_note', 'required', NULL, NULL, 'Configuration', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'mount_system', 'required', NULL, NULL, 'Mount system', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'lumens_max', 'required', NULL, NULL, 'Lumens (max)', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'candela_max', 'required', NULL, NULL, 'Candela (max)', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'battery_type', 'required', NULL, NULL, 'Battery type', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'rechargeable', 'required', NULL, NULL, 'Rechargeable', 70);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'length_in', 'required', NULL, NULL, 'Length (in)', 80);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'ipx_rating', 'required', NULL, NULL, 'IPX rating', 90);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'multiple_light_settings', 'required', NULL, NULL, 'Multiple light settings', 100);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'has_strobe', 'required', NULL, NULL, 'Strobe', 110);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'has_infrared', 'required', NULL, NULL, 'Infrared', 120);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'has_laser', 'required', NULL, NULL, 'Laser', 130);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('light', 'laser_color', 'required', 'has_laser', '{true}', 'Laser color', 140);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'caliber', 'required', NULL, NULL, 'Caliber', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'mounting_type', 'required', NULL, NULL, 'Mounting type', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'requires_threaded_barrel', 'required', NULL, NULL, 'Needs a threaded barrel', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'thread_pitch', 'required', NULL, NULL, 'Thread pitch', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'port_design', 'required', NULL, NULL, 'Port design', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'comes_with_barrel', 'required', NULL, NULL, 'Comes with a barrel', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'included_barrel', 'required', 'comes_with_barrel', '{true}', 'Included barrel', 70);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'barrel_length_in', 'required', 'comes_with_barrel', '{true}', 'Included barrel length (in)', 80);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('compensator', 'length_in', 'optional', 'comes_with_barrel', '{false}', 'Compensator length (in)', 90);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('trigger', 'profile', 'required', NULL, NULL, 'Profile', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('trigger', 'adjustable', 'required', NULL, NULL, 'Adjustable', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('trigger', 'adjustment_type', 'required', NULL, NULL, 'Adjustment type', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('trigger', 'safety_type', 'required', NULL, NULL, 'Safety type', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('trigger', 'drop_in', 'required', NULL, NULL, 'Drop-in', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('trigger', 'pull_weight_lb', 'optional', NULL, NULL, 'Pull weight (lb)', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('trigger', 'pull_weight_text', 'optional', NULL, NULL, 'Pull weight (as stated)', 70);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('mag_release', 'caliber', 'required', NULL, NULL, 'Caliber', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('mag_release', 'style', 'required', NULL, NULL, 'Style', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('mag_release', 'texture', 'required', NULL, NULL, 'Texture', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('mag_release', 'material', 'optional', NULL, NULL, 'Material (filled from the product''s material)', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('mag_release', 'length_added_in', 'optional', NULL, NULL, 'Length added (in)', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('mag_release', 'includes_spring_stop', 'optional', NULL, NULL, 'Includes spring stop', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magwell', 'attachment_method', 'required', NULL, NULL, 'Attachment method', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magwell', 'is_combo', 'required', NULL, NULL, 'Combo (magwell + grip)', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magwell', 'includes_hardware', 'required', NULL, NULL, 'Includes hardware', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('basepad', 'basepad_type', 'required', NULL, NULL, 'Base pad type', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('basepad', 'fits_mag_type', 'required', NULL, NULL, 'Fits magazine', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('basepad', 'capacity_change', 'required', NULL, NULL, 'Capacity change (rounds)', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide_release', 'texture', 'required', NULL, NULL, 'Texture', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('slide_release', 'uses_oem_spring', 'required', NULL, NULL, 'Uses the OEM spring', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('safety_selector', 'is_ambidextrous', 'required', NULL, NULL, 'Ambidextrous', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('safety_selector', 'includes_detent_spring', 'required', NULL, NULL, 'Includes detent spring', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('safety_selector', 'kit_contents', 'required', NULL, NULL, 'Kit contents', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('takedown_lever', 'takedown_type', 'required', NULL, NULL, 'Takedown type', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('takedown_lever', 'has_thumb_rest', 'required', NULL, NULL, 'Thumb rest', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('takedown_lever', 'optic_compatibility_notes', 'optional', NULL, NULL, 'Optic compatibility notes', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('recoil_spring', 'slide_length_in', 'required', NULL, NULL, 'Slide length (in)', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('recoil_spring', 'spring_weight', 'required', NULL, NULL, 'Spring weight', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('recoil_spring', 'captured', 'required', NULL, NULL, 'Captured', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('recoil_spring', 'spring_type', 'optional', NULL, NULL, 'Spring type', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('recoil_spring', 'guide_rod_material', 'optional', NULL, NULL, 'Guide rod material', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('sight', 'sight_position', 'required', NULL, NULL, 'Front, rear or set', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('sight', 'height', 'required', NULL, NULL, 'Height', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('sight', 'sight_type', 'required', NULL, NULL, 'Sight type', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('sight', 'dovetail', 'optional', NULL, NULL, 'Dovetail / slide cut', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('sight', 'rear_notch', 'optional', NULL, NULL, 'Rear notch', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magazine', 'capacity', 'required', NULL, NULL, 'Capacity (rounds)', 10);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magazine', 'caliber', 'required', NULL, NULL, 'Caliber', 20);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magazine', 'mag_style', 'required', NULL, NULL, 'Style', 30);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magazine', 'fits_models', 'required', NULL, NULL, 'Fits models', 40);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magazine', 'not_compatible_with', 'optional', NULL, NULL, 'Not compatible with', 50);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magazine', 'body_material', 'optional', NULL, NULL, 'Body material', 60);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magazine', 'witness_holes', 'optional', NULL, NULL, 'Witness holes', 70);
INSERT INTO "public"."spec_field_rules" ("category", "field", "requirement", "only_when_field", "only_when_values", "label", "sort_order") VALUES ('magazine', 'included_extras', 'optional', NULL, NULL, 'Included extras', 80);

--
-- PostgreSQL database dump complete
--

-- ── magazine_housing_fit ────────────────────────────────────────────────────
-- Reference rows keyed by product slug (supabase/migrations/20261014220416_magazine_housing_fit_rows.sql
-- holds the same statement with the reasoning). They reference products,
-- which this seed does not carry, so on an empty database this inserts
-- nothing and says so; on a branch that holds the nine magazines it inserts
-- the 32 approved rows. Keep this block identical to the migration's.

do $$
declare
  n_before integer; n_after integer;
begin
  select count(*) into n_before from public.magazine_housing_fit;

  insert into public.magazine_housing_fit (magazine_product_id, housing_class, fit, note, source)
  select p.id, r.housing_class, r.fit, r.note, coalesce(r.source, p.url)
  from (values
    -- 10rd Flush — https://www.sigsauer.com/p365-micro-compact-10rd-9mm-magazine.html
    ('sig-sauer-p365-10rd-flush-mag', 'p365',    'flush',          'Factory flush magazine for the P365', null),
    ('sig-sauer-p365-10rd-flush-mag', 'p365xl',  'not_compatible', 'SIG lists it as not compatible with the P365X and P365-XL', null),
    ('sig-sauer-p365-10rd-flush-mag', 'xmacro',  'not_compatible', 'SIG lists it as not compatible with the XMACRO and AXG', null),
    ('sig-sauer-p365-10rd-flush-mag', 'fuse',    'not_compatible', 'SIG lists it as not compatible with the FUSE', null),
    -- 10rd Finger Extension — https://www.sigsauer.com/p365-micro-compact-10rd-9mm-extended-magazine.html
    ('sig-sauer-p365-10rd-finger-ext-mag', 'p365',   'extended',       'Same 10 rounds as the flush mag; the baseplate adds a pinky rest below the grip, no added capacity', null),
    ('sig-sauer-p365-10rd-finger-ext-mag', 'p365xl', 'not_compatible', 'SIG lists it as not compatible with the P365X and P365-XL', null),
    ('sig-sauer-p365-10rd-finger-ext-mag', 'xmacro', 'not_compatible', 'SIG lists it as not compatible with the XMACRO and AXG', null),
    ('sig-sauer-p365-10rd-finger-ext-mag', 'fuse',   'not_compatible', 'SIG lists it as not compatible with the FUSE', null),
    -- X/XL 10rd Flush — https://www.sigsauer.com/p365xl-micro-compact-10rd-9mm-magazine-1.html
    ('sig-sauer-p365-x-xl-10rd-mag', 'p365xl', 'flush',          'Factory flush magazine for the P365X, P365-XL and XL COMP', null),
    ('sig-sauer-p365-x-xl-10rd-mag', 'p365',   'not_compatible', 'Not recommended per SIG', null),
    ('sig-sauer-p365-x-xl-10rd-mag', 'xmacro', 'not_compatible', 'Not recommended per SIG', null),
    ('sig-sauer-p365-x-xl-10rd-mag', 'fuse',   'not_compatible', 'Not recommended per SIG', null),
    -- XMACRO 10rd — https://www.sigsauer.com/p365-xmacro-10rd-magazine.html
    ('sig-sauer-p365-xmacro-10rd-mag', 'xmacro', 'flush', 'Factory flush 10-round for the XMACRO, XMACRO COMP, AXG and DH3', null),
    ('sig-sauer-p365-xmacro-10rd-mag', 'fuse',   'flush', 'Factory 10-round for the XMACRO-length grip; sits flush in the FUSE', null),
    -- 12rd — https://www.sigsauer.com/p365-micro-compact-12rd-9mm-magazine.html
    ('sig-sauer-p365-x-xl-12rd-mag', 'p365xl', 'flush',                   'Factory magazine for the P365X and P365-XL', null),
    ('sig-sauer-p365-x-xl-12rd-mag', 'p365',   'with_included_baseplate', 'Swap to the included P365 baseplate; extends below the grip', null),
    ('sig-sauer-p365-x-xl-12rd-mag', 'xmacro', 'not_compatible',          'SIG lists it as not compatible with the XMACRO and AXG', null),
    ('sig-sauer-p365-x-xl-12rd-mag', 'fuse',   'not_compatible',          'SIG lists it as not compatible with the FUSE', null),
    -- 15rd — https://www.sigsauer.com/p365-micro-compact-15rd-9mm-magazine.html
    ('sig-sauer-p365-x-xl-15rd-mag', 'p365',   'extended',                'Extends below the grip', null),
    ('sig-sauer-p365-x-xl-15rd-mag', 'p365xl', 'with_included_baseplate', 'Swap to the included P365X / P365-XL baseplate; extends below the grip', null),
    ('sig-sauer-p365-x-xl-15rd-mag', 'xmacro', 'not_compatible',          'SIG lists it as not compatible with the XMACRO and AXG', null),
    ('sig-sauer-p365-x-xl-15rd-mag', 'fuse',   'not_compatible',          'SIG lists it as not compatible with the FUSE', null),
    -- 17rd — https://www.sigsauer.com/p365-xmacro-17rd-magazine.html
    ('sig-sauer-p365-17rd-mag', 'xmacro', 'flush',                   'Factory magazine for the XMACRO, XMACRO COMP, AXG and DH3', null),
    ('sig-sauer-p365-17rd-mag', 'fuse',   'flush',                   'Factory flush magazine for the FUSE; the FUSE also ships with extended 21-round mags', 'https://americanrifleman.org/content/new-for-2024-sig-sauer-p365-fuse'),
    ('sig-sauer-p365-17rd-mag', 'p365',   'with_included_baseplate', 'Swap to the included P365 floor plate; extends well below the grip', null),
    ('sig-sauer-p365-17rd-mag', 'p365xl', 'with_included_baseplate', 'Swap to the included P365X / P365-XL floor plate; extends below the grip', null),
    -- AXG LEGION 17rd — https://www.sigsauer.com/p365-axg-legion-17-rd-magazine-black.html
    ('sig-sauer-p365-axg-legion-17rd-mag', 'xmacro', 'flush', 'LEGION alloy basepad installed; factory magazine for the AXG Legion, fits the XMACRO, XMACRO COMP and DH3', null),
    ('sig-sauer-p365-axg-legion-17rd-mag', 'fuse',   'flush', 'LEGION alloy basepad; sits flush in the FUSE grip', null),
    -- TTI 20rd — https://tarantacticalinnovations.com/sig-x-macro-completed-magazine-w-tti-versatile-basepad/
    ('tti-xmacro-completed-mag-w-basepad', 'xmacro', 'extended', '+3 TTI basepad extends below the grip', null),
    ('tti-xmacro-completed-mag-w-basepad', 'p365',   'extended', 'MACRO-length body with a +3 basepad; extends well below the grip', null),
    ('tti-xmacro-completed-mag-w-basepad', 'p365xl', 'extended', 'MACRO-length body with a +3 basepad; extends below the grip', null),
    ('tti-xmacro-completed-mag-w-basepad', 'fuse',   'extended', 'Factory 17-round body with TTI''s +3 basepad; extends below the grip', null)
  ) as r (slug, housing_class, fit, note, source)
  join public.products p on p.slug = r.slug and p.category::text = 'magazine'
  on conflict (magazine_product_id, housing_class) do nothing;

  select count(*) into n_after from public.magazine_housing_fit;
  raise notice 'magazine_housing_fit: % row(s) inserted (% before, % after); 32 expected where all nine magazines exist',
    n_after - n_before, n_before, n_after;
end $$;

-- ── magazine_housing_fit: the 21rd magazine ─────────────────────────────────
-- Same statement as supabase/migrations/20261014234727_magazine_housing_fit_21rd.sql
-- (four rows for sig-sauer-p365-21rd-mag); the same guard as the block above,
-- so it inserts nothing on a database with no products. Keep identical.

do $$
declare
  n_before integer; n_after integer;
begin
  select count(*) into n_before from public.magazine_housing_fit;

  insert into public.magazine_housing_fit (magazine_product_id, housing_class, fit, note, source)
  select p.id, r.housing_class, r.fit, r.note, 'https://www.sigsauer.com/p365-9mm-21rd-magazine.html'
  from (values
    ('sig-sauer-p365-21rd-mag', 'xmacro', 'extended', 'Extends below the grip; the baseplate meets the grip with no gap'),
    ('sig-sauer-p365-21rd-mag', 'fuse',   'extended', 'The FUSE''s factory extended mag; the baseplate meets the grip with no gap'),
    ('sig-sauer-p365-21rd-mag', 'p365',   'extended', 'Works, but leaves a gap between the baseplate and the shorter grip (per SIG)'),
    ('sig-sauer-p365-21rd-mag', 'p365xl', 'extended', 'Works, but leaves a gap between the baseplate and the shorter grip (per SIG)')
  ) as r (slug, housing_class, fit, note)
  join public.products p on p.slug = r.slug and p.category::text = 'magazine'
  on conflict (magazine_product_id, housing_class) do nothing;

  select count(*) into n_after from public.magazine_housing_fit;
  raise notice 'magazine_housing_fit (21rd): % row(s) inserted (% before, % after); 4 expected where the magazine exists',
    n_after - n_before, n_before, n_after;
end $$;

-- ── magazine_housing_fit: the four Magpul AMAG SG9 magazines ────────────────
-- Same statement as supabase/migrations/20261015035038_magazine_housing_fit_magpul_amag.sql
-- (12 rows); the same guard as the blocks above, so it inserts nothing on a
-- database with no products. Keep identical.

do $$
declare
  n_before integer; n_after integer;
begin
  select count(*) into n_before from public.magazine_housing_fit;

  insert into public.magazine_housing_fit (magazine_product_id, housing_class, fit, note, source)
  select p.id, r.housing_class, r.fit, r.note, r.source
  from (values
    ('magpul-amag-10-sg9-p365-mag', 'p365',   'flush',                   'Flush with the standard floorplate; an extended floorplate is also in the box', 'https://magpul.com/amag-10-sg9-sig-p365.html'),
    ('magpul-amag-10-sg9-p365-mag', 'p365xl', 'not_compatible',          'Magpul: not compatible with X/XL grip modules',                                  'https://magpul.com/amag-10-sg9-sig-p365.html'),
    ('magpul-amag-10-sg9-p365-mag', 'xmacro', 'not_compatible',          'Magpul: not compatible with Macro grip modules',                                 'https://magpul.com/amag-10-sg9-sig-p365.html'),
    ('magpul-amag-12-sg9-p365-mag', 'p365',   'with_included_baseplate', 'Fit the included Standard/Micro grip extension',                                 'https://magpul.com/amag-12-sg9-sig-p365.html'),
    ('magpul-amag-12-sg9-p365-mag', 'p365xl', 'flush',                   'Flush with the included X/XL floorplate',                                        'https://magpul.com/amag-12-sg9-sig-p365.html'),
    ('magpul-amag-12-sg9-p365-mag', 'xmacro', 'not_compatible',          'Magpul: not compatible with Macro grip modules',                                 'https://magpul.com/amag-12-sg9-sig-p365.html'),
    ('magpul-amag-15-sg9-p365-mag', 'p365',   'with_included_baseplate', 'Fit the included Standard/Micro grip extension',                                 'https://magpul.com/amag-15-sg9-sig-p365.html'),
    ('magpul-amag-15-sg9-p365-mag', 'p365xl', 'with_included_baseplate', 'Fit the included X/XL grip extension',                                           'https://magpul.com/amag-15-sg9-sig-p365.html'),
    ('magpul-amag-15-sg9-p365-mag', 'xmacro', 'extended',                'Sits slightly below the grip; a little of the silver body shows',                'https://magpul.com/amag-15-sg9-sig-p365.html'),
    ('magpul-amag-17-sg9-p365-mag', 'p365',   'with_included_baseplate', 'Fit the included Standard/Micro grip extension',                                 'https://magpul.com/amag-17-sg9-sig-p365.html'),
    ('magpul-amag-17-sg9-p365-mag', 'p365xl', 'with_included_baseplate', 'Fit the included X/XL grip extension',                                           'https://magpul.com/amag-17-sg9-sig-p365.html'),
    ('magpul-amag-17-sg9-p365-mag', 'xmacro', 'flush',                   'Flush with the standard floorplate',                                             'https://magpul.com/amag-17-sg9-sig-p365.html')
  ) as r (slug, housing_class, fit, note, source)
  join public.products p on p.slug = r.slug and p.category::text = 'magazine'
  on conflict (magazine_product_id, housing_class) do nothing;

  select count(*) into n_after from public.magazine_housing_fit;
  raise notice 'magazine_housing_fit (Magpul AMAG): % row(s) inserted (% before, % after); 12 expected where all four magazines exist',
    n_after - n_before, n_before, n_after;
end $$;
