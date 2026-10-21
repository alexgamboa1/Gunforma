-- products.name follows one convention: the MODEL alone, never the brand.
-- The brand is `manufacturers.name` through `products.brand_id`, and every
-- page prints the two together through displayProductName() /
-- displayProductParts() (netlify/functions/_display-name.mjs and
-- js/display-name.js). Until this file the stored name carried the brand
-- only when the maker's own title did — measured 2026-10-20, 204 of the
-- 277 live names did ("Holosun 507K X2", "Icarus Precision 311 Series
-- 311") and 73 did not (every magazine, every light, "Osight SE") — so
-- the helper had to guess, from the name's own words, whether a brand was
-- already there. "Herrington Arms HA Magwell for P365 X Macro" is what the
-- guess could not fix: HA is the brand's initials, so the stored name
-- doubled its brand and was printed that way.
--
-- 236 products are renamed here, from the review of 2026-10-20
-- (product-name-convention-2026-10-20.csv in the shared notes folder;
-- the proposed names are reproduced below, so this file is the record).
-- The other 41 live names already were the model alone and are not
-- listed. Beyond dropping the brand, a name loses what a spec column
-- already holds — a barrel's inch length (barrel_specs.barrel_length_in),
-- a magazine's model list (magazine_specs.fits_models), "Stainless Steel"
-- (products.material), Magpul's SG9 designator — and keeps what no column
-- holds ("Macro Frame" on a mag release, Night Fision's sight heights).
-- Slugs, ids, prices, links and every other column are untouched; the
-- trigger products_updated_at stamps each renamed row, so the sitemap
-- lastmod moves for them, which is right.
--
-- Builds are NOT touched: builds.parts_snapshot froze each part's name
-- and brand at the time of the build, and displayProductParts() strips
-- one leading brand form from a frozen name for exactly that reason.
--
-- Exact and refusing: a row is renamed only when its id, slug AND current
-- name are the ones this file was written against. A listed product whose
-- live name is neither the old nor the new one was renamed by someone
-- else since 2026-10-20, and the whole file raises rather than overwrite
-- that. On a fresh database (migrations then seed.sql, which loads no
-- products) none of the listed ids exist, which is a NOTICE and a return;
-- some of them existing is a different catalog, and raises. Idempotent: a
-- row already carrying its new name matches nothing and is counted as
-- done. The last check is the convention itself: after the update no live
-- product's name may equal its brand or open with "<brand> ".

do $$
declare
  n_listed  constant integer := 236;
  n_present integer;
  n_renamed integer;
  n_bad     integer;
  bad_rows  text;
begin
  create temp table naming_convention (
    id       uuid primary key,
    slug     text not null,
    old_name text not null,
    new_name text not null
  ) on commit drop;

  insert into naming_convention (id, slug, old_name, new_name) values
    ('42db8c43-065a-4a68-8a3b-620763b35900', 'norsso-n365-cport', 'Norsso N365 3.1" C Port Barrel', 'N365 C Port Barrel'),
    ('970202a5-1a39-4d19-8062-d6abb454e449', 'norsso-n365-fuse-cport', 'Norsso N365-FUSE 4.3" 9mm C Port Barrel', 'N365-FUSE C Port Barrel'),
    ('b355ce77-2c49-4a99-8527-e52ae255d2cb', 'norsso-n365-fuse-eport', 'Norsso N365-FUSE 4.3" 9mm E Port Barrel', 'N365-FUSE E Port Barrel'),
    ('f47ea0b5-01fc-4b3a-9964-9a8f806745ca', 'norsso-n365xl-cport', 'Norsso N365XL 3.7" C Port Barrel', 'N365XL C Port Barrel'),
    ('2d1f2531-8236-4a50-81fa-c001cdb862df', 'norsso-p365-fuse-standard', 'Norsso P365-FUSE 4.3" Standard Barrel, LVL1.5', 'P365 FUSE LVL1.5 Standard Barrel'),
    ('377c1752-0a69-429b-b8f5-0a6d076b7b86', 'norsso-p365-standard-lvl1-5', 'Norsso P365 3.1" LVL1.5 Standard Barrel', 'P365 LVL1.5 Standard Barrel'),
    ('05951ceb-f7da-4cfe-90dd-24bbab20fce2', 'norsso-p365-threaded-lvl1-5', 'Norsso P365 3.1" LVL1.5 Threaded Barrel', 'P365 LVL1.5 Threaded Barrel'),
    ('c449ec63-eede-487a-b619-4dbedf58ec39', 'norsso-p365-xl-standard-lvl1-5', 'Norsso P365-XL/XMACRO 3.7" LVL1.5 Standard Barrel', 'P365 XL LVL1.5 Standard Barrel'),
    ('33bbce99-ad06-45dd-9780-c3cf771ab92e', 'norsso-p365-xl-threaded-lvl1-5', 'Norsso P365-XL/XMACRO 3.7" LVL1.5 Threaded Barrel', 'P365 XL LVL1.5 Threaded Barrel'),
    ('28a436cb-edf0-41af-9909-f40219faf2e9', 'true-precision-p365-fuse-non-threaded', 'True Precision P365 Fuse 4.3" Non-Threaded Barrels', 'P365 FUSE Non-Threaded Barrel'),
    ('79304bd8-e0c9-417a-a905-a2c19d9c69ae', 'true-precision-p365-fuse-threaded', 'True Precision P365 Fuse 4.3" Threaded Barrels', 'P365 FUSE Threaded Barrel'),
    ('4a17dd31-7094-4377-8563-8c15700a6370', 'true-precision-p365-non-threaded', 'True Precision P365 3.1" Non-Threaded Barrels', 'P365 Non-Threaded Barrel'),
    ('d99c4043-87fe-449e-80e9-41f34439409b', 'true-precision-p365-threaded', 'True Precision P365 3.1" Threaded Barrels', 'P365 Threaded Barrel'),
    ('0657a453-c53a-4c93-81c1-ac04699269d1', 'true-precision-p365-xl-non-threaded', 'True Precision P365XL 3.7" Non-Threaded Barrels', 'P365 XL Non-Threaded Barrel'),
    ('92de409f-d609-4a7f-9ee9-868f9985c007', 'true-precision-p365-xl-threaded', 'True Precision P365XL 3.7" Threaded Barrels', 'P365 XL Threaded Barrel'),
    ('11e3fc6f-85ba-4365-a410-3c26f008e640', 'zaffiri-p365-flush-crown', 'Zaffiri Precision P365 Flush & Crown Barrel', 'P365 Flush & Crown Barrel'),
    ('b33aba76-d397-4ca2-b89c-4a671f3743c3', 'zaffiri-p365-threaded', 'Zaffiri Precision P365 Threaded Barrel', 'P365 Threaded Barrel'),
    ('568c2791-f0e5-4040-8fb7-4b7224b46901', 'zaffiri-p365-xl-flush-crown', 'Zaffiri Precision P365XL Flush & Crown Barrel', 'P365 XL Flush & Crown Barrel'),
    ('2df07af2-1456-56fa-8c9c-a546bdffbfde', 'zaffiri-p365-xl-ported', 'Zaffiri Precision P365XL Ported Barrel', 'P365 XL Ported Barrel'),
    ('c8125a73-81d1-44b6-86a0-10a1df73d127', 'zaffiri-p365-xl-threaded', 'Zaffiri Precision P365XL Threaded Barrel', 'P365 XL Threaded Barrel'),
    ('2ee8c88c-7c48-584f-977a-c9b4786dc59c', 'armory-craft-pinky-ext-p365-10rd', 'Armory Craft P365 Pinky Extension for 10-Round Magazines', '10rd Pinky Extension'),
    ('56fdda31-3cb1-43be-b254-63128a47a30d', 'ecm-precision-carry-basepad-p365xmacro', 'ECM Precision Carry 17-Round Magazine Base Pad for the P365', 'Carry Basepad'),
    ('c421b665-c0c0-5f23-91d3-d513df8527ed', 'hogue-rubber-basepad-p365-10rd', 'Hogue OverMolded Rubber Grip Extension Base Pad (10-Round) for P365', 'OverMolded 10rd Grip Extension'),
    ('29aa6d8a-3a0f-5227-a151-95db763c2279', 'hogue-rubber-basepad-p365xl-15rd', 'Hogue OverMolded Rubber Grip Extension Base Pad (15-Round) for P365X/XL', 'OverMolded 15rd Grip Extension'),
    ('677ff0c6-77d1-5f33-87df-effb2b4a1f4d', 'jl-billet-17rd-adapter-p365-oem', 'JL Billet 17-Round Mag Adaptor for SIG P365 OEM Grip', '17rd Mag Adaptor for P365 Grip'),
    ('b35cab23-8135-51da-aabb-01710ac2d2b7', 'radian-tru17-basepad-p365xmacro', 'Radian TRU-17 Magazine Base Pad (2-Pack)', 'TRU-17 Basepad'),
    ('f309b3ee-26f8-4b64-812b-b072d05601ca', 'springer-precision-3-mag-extension-p365xmacro', '+3 Magazine Extension for Sig Sauer X Macro 17rd Mags', '+3 Magazine Extension'),
    ('378e4188-ec70-4c04-9f99-07616304de1c', 'springer-precision-carry-basepad-p365xmacro', 'Carry Basepad for Sig Sauer - P365 X-Macro', 'Carry Basepad'),
    ('f0c5e673-843e-5595-aac5-bb620e77ae5d', 'tyrant-cnc-baseplate-p365xmacro', 'Tyrant CNC P365 XMacro Base Plate', 'XMacro Base Plate'),
    ('793ff97a-2497-51e3-9f5f-863536b98b4d', 'tyrant-cnc-mag-ext-p365xmacro-plus3', 'Tyrant CNC P365 XMacro +3 Magazine Extension', '+3 Magazine Extension'),
    ('36341a83-9ebc-4936-9e36-0c2be6657b2a', 'armory-craft-comp-p365', 'Armory Craft P365 Compensator', 'P365 Compensator'),
    ('c57ec249-a975-471d-b63d-58388f3c2852', 'faxon-firearms-exos-comp-p365', 'Faxon Exos P365 Compensator', 'Exos Compensator'),
    ('10d684c2-d2f1-4d7f-ad19-8ccb7ff98660', 'herrington-arms-hc365-p365', 'Herrington Arms HC365 Compensator P365', 'HC365 Compensator'),
    ('1b84bd5b-311c-4631-94c3-edf08d689098', 'herrington-arms-hc365p-p365', 'Herrington Arms HC365P Compensator P365', 'HC365P Compensator'),
    ('476e3b62-847f-4843-85e4-6098bf8ac899', 'herrington-arms-zero-p365', 'Herrington Arms Zero Series Compensator P365', 'Zero Series Compensator'),
    ('30e81cc3-5107-4382-95f6-4ff01ce700b4', 'mcarbo-comp-p365', 'MCARBO P365 Compensator', 'P365 Compensator'),
    ('205f8cee-45a1-46bd-bd44-769379ef0933', 'mcarbo-tbarrel-comp-p365', 'MCARBO P365 Threaded Barrel and Compensator', 'P365 Threaded Barrel and Compensator'),
    ('5e5fb23e-fef6-4137-9ab6-3fd10f3761ed', 'pmm-tbarrel-comp-p365', 'PMM P365 Compensator', 'P365 Compensator'),
    ('fe14a0ce-1f42-47f7-9388-e3b50aa4be29', 'pmm-tbarrel-comp-p365xl', 'PMM P365XL Compensator', 'P365 XL Compensator'),
    ('37fab16d-024f-4344-9d4d-1adde437d2b9', 'radian-ramjet-afterburner-p365-comp', 'Radian Ramjet + Afterburner Compensator P365', 'Ramjet + Afterburner P365'),
    ('00cd9260-bd0d-47a4-88f7-2a1035fef618', 'radian-ramjet-afterburner-p365-xl-comp', 'Radian Ramjet + Afterburner Compensator P365XL', 'Ramjet + Afterburner P365 XL'),
    ('7d01a31e-255a-4b9f-92f1-4b9f76609318', 'true-precision-tl-comp-p365', 'True Precision True-Lock Compensator P365', 'True-Lock Compensator'),
    ('eb0b6aa4-04b0-489b-909c-fe3de69a7988', 'armory-craft-grip-module-p365xmacro', 'Armory Craft P365 XMACRO/FUSE Grip Module', 'P365 XMacro/FUSE Grip Module'),
    ('1535a9fb-2edd-5478-858f-bdf1b5170c66', 'ecm-precision-r11-edge-fuse', 'ECM Precision R11 Edge Fuse', 'R11 Edge Fuse'),
    ('e36efb26-45f9-5b4c-b68f-a44ab129e75b', 'ecm-precision-r11-edge-fuse-comp', 'ECM Precision R11 Edge Fuse Comp', 'R11 Edge Fuse Comp'),
    ('81ff51e4-851a-547a-b506-e66cb0df635b', 'ecm-precision-r11-edge-xmacro', 'ECM Precision R11 Edge XMacro', 'R11 Edge XMacro'),
    ('d20b1360-629b-5c2e-a769-74f8b6d0feac', 'ecm-precision-r11-fuse', 'ECM Precision R11 Fuse', 'R11 Fuse'),
    ('aae47516-1ce9-5c55-b259-e2ee64706d5d', 'ecm-precision-r11-fuse-comp', 'ECM Precision R11 Fuse Comp', 'R11 Fuse Comp'),
    ('5eaf2c41-a291-56b2-8fb5-ba071abe8195', 'ecm-precision-r11-macro', 'ECM Precision R11 Macro', 'R11 Macro'),
    ('cef114ff-9ca5-5076-a29a-c553e4403815', 'grayguns-p365-gm', 'Grayguns P365 Laser-Sculpted Grip Module', 'P365 Laser-Sculpted Grip Module'),
    ('1e2bd3e0-e415-5052-b491-d0272a969099', 'grayguns-p365-xl-gm', 'Grayguns P365XL Laser-Sculpted Grip Module', 'P365 XL Laser-Sculpted Grip Module'),
    ('aebef462-9546-5c72-beed-00bb2fa91635', 'grayguns-p365-xmacro-gm', 'Grayguns P365 XMACRO Laser-Sculpted Grip Module', 'P365 XMacro Laser-Sculpted Grip Module'),
    ('90df9567-41e3-44db-8ad3-fc4e3a6c1856', 'icarus-precision-311', 'Icarus Precision 311 Series 311', '311'),
    ('b3dcebf2-aa65-463d-955e-e2f66c558307', 'icarus-precision-311-fuse', 'Icarus Precision 311 Series 311 FUSE', '311 FUSE'),
    ('cda18ea3-8ef5-44e1-a171-e07302b37399', 'icarus-precision-311-fuse-sl', 'Icarus Precision 311 Series 311 FUSE SL', '311 FUSE SL'),
    ('7a31ce5e-8eec-45e3-97a8-204d03029ad7', 'icarus-precision-311-sl', 'Icarus Precision 311 Series 311 SL', '311 SL'),
    ('b5db2600-a4ea-5ade-8b64-1e3f928a6302', 'icarus-precision-ace-axg-xmacro', 'Icarus Precision AXG Series AXG MACRO (A.C.E.)', 'A.C.E. AXG MACRO'),
    ('1cb77f04-390e-5981-be7b-ab7bd4989e9f', 'icarus-precision-ace-fuse', 'Icarus Precision MACRO Series FUSE MACRO (A.C.E.)', 'A.C.E. FUSE MACRO'),
    ('8553d96f-a585-570a-afb0-00303c0d44d9', 'icarus-precision-ace-fuse-evo', 'Icarus Precision EVO Series FUSE EVO (A.C.E.)', 'A.C.E. FUSE EVO'),
    ('d47664c6-b44d-52b1-8776-51bd8effff36', 'icarus-precision-ace-xl-evo', 'Icarus Precision EVO Series XL EVO (A.C.E.)', 'A.C.E. XL EVO'),
    ('3c54ce15-3431-5949-9c1b-34418c668dfb', 'icarus-precision-ace-xmacro', 'Icarus Precision MACRO Series X MACRO (A.C.E.)', 'A.C.E. X MACRO'),
    ('8f54f01a-f512-51a5-bfd8-18b3e25fa3e2', 'icarus-precision-air-xmacro', 'Icarus Precision AIR Polymer Series XMACRO', 'AIR XMACRO'),
    ('a24e872a-3761-4e29-905e-7365d988b7f4', 'icarus-precision-axg-fuse', 'Icarus Precision AXG Series AXG FUSE', 'AXG FUSE'),
    ('190ead60-1e58-44be-b642-c2e17f9970a3', 'icarus-precision-elite-x-elite', 'Icarus Precision Elite Series X Elite', 'X Elite'),
    ('abcc04df-00be-4df4-9202-981029eb00b4', 'icarus-precision-evo-x-evo', 'Icarus Precision EVO Series X EVO', 'X EVO'),
    ('8b991be7-4519-43e3-80e2-95d85b30e671', 'icarus-precision-hybrid-standard', 'Icarus Precision Hybrid Series Standard Hybrid', 'Standard Hybrid'),
    ('603969ed-efe1-4af2-88d5-78293a46cb3c', 'icarus-precision-hybrid-xl', 'Icarus Precision Hybrid Series XL Hybrid', 'XL Hybrid'),
    ('5da79bb5-e631-4020-af8b-7838a671a81e', 'icarus-precision-hybrid-xl-pro', 'Icarus Precision Hybrid Series XL Hybrid Pro', 'XL Hybrid Pro'),
    ('a47bceec-19f0-4a06-a4ef-9fb2fc897654', 'icarus-precision-macro-sub-macro', 'Icarus Precision MACRO Series Sub MACRO', 'Sub MACRO'),
    ('f94153e7-bdf6-516f-9a42-55aae687793c', 'icarus-precision-pro-elite-ace-xmacro', 'Icarus Precision Elite Series Pro Elite (A.C.E.)', 'A.C.E. Pro Elite'),
    ('eafebf30-afc5-5bd8-b4cc-3a4da942c2f7', 'mischief-machine-alpha-g3-fuse', 'Mischief Machine Alpha Gen 3 Fuse', 'Alpha Gen 3 Fuse'),
    ('c11b0827-5127-5e98-a209-0d1915c136c8', 'mischief-machine-alpha-g3-xmacro', 'Mischief Machine Alpha Gen 3 XMacro', 'Alpha Gen 3 XMacro'),
    ('a2b9da19-a288-5572-aac2-df92eacfb2ad', 'mischief-machine-com-g2-fuse', 'Mischief Machine Commander G2 XMacro/Fuse Plus', 'Commander G2 Fuse Plus'),
    ('d78cea8e-1b35-5ce4-a172-6b187986164a', 'mischief-machine-com-g2-xl', 'Mischief Machine Commander G2 X and XL', 'Commander G2 X/XL'),
    ('63e75631-75c2-55b3-b4ab-a4740210af34', 'mischief-machine-com-g2-xmacro', 'Mischief Machine Commander G2 XMacro', 'Commander G2 XMacro'),
    ('55d51357-f6b1-5223-9319-5a95b86de87e', 'mischief-machine-com-g2-xxl', 'Mischief Machine Commander G2 XXL', 'Commander G2 XXL'),
    ('3df783ed-294c-57e1-93c1-4b054273bb21', 'shalotek-p365-flex-xlr-12', 'Shalotek FLEX XLR-12 Grip Module', 'FLEX XLR-12'),
    ('5f752ce9-739c-5a0c-a958-a5d315106601', 'shalotek-p365-flex-xlr-17', 'Shalotek FLEX XLR-17 Grip Module', 'FLEX XLR-17'),
    ('4840a337-7c96-5e0f-afc2-8289300ffb5a', 'shalotek-p365-flex-xr-10', 'Shalotek FLEX XR-10 Grip Module', 'FLEX XR-10'),
    ('885041d8-d540-56e9-aff4-9598a5654788', 'shalotek-p365-flex-xr-17', 'Shalotek FLEX XR-17 Grip Module', 'FLEX XR-17'),
    ('264bba8d-a491-50e8-8906-e8a586cfeef7', 'shalotek-p365-flex-xxlr-17', 'Shalotek FLEX XXLR-17 Grip Module', 'FLEX XXLR-17'),
    ('a650efb1-df0b-5a1c-890a-07e8da789507', 'sharps-bros-p365-m01', 'Sharps Bros P365X/ P365XL M01', 'M01'),
    ('11300d81-fb8c-56e9-814c-438edaca45e1', 'sharps-bros-p365-m05-g3', 'Sharps Bros P365 X-Macro M05 G3', 'M05 G3'),
    ('31705a2b-9b6c-5c37-b981-6928859efba5', 'sig-sauer-p365-fuse-xmacro-gm-oem', 'Sig Sauer P365 Fuse/X-Macro OEM', 'P365 FUSE Grip Module'),
    ('ed806fcc-4ac5-515f-adc0-5cc59c13c278', 'sig-sauer-p365-gm-oem', 'Sig Sauer P365 OEM', 'P365 Grip Module'),
    ('dbc63dd2-5b12-5c2b-a715-7b34331a1c92', 'sig-sauer-p365-xl-gm-oem', 'Sig Sauer P365 XL OEM', 'P365 XL Grip Module'),
    ('9ea56cf0-84f1-5ede-b65e-0d4361db5d9f', 'sig-sauer-p365-xmacro-gm-oem', 'Sig Sauer P365 X-Macro OEM', 'P365 XMacro Grip Module'),
    ('54238e93-4f4a-573d-9c19-e78dd97c7bae', 'strike-industries-p365-gm', 'Strike Industries SIG P365/365XL Enhanced Grip Module', 'Enhanced Grip Module'),
    ('947d13a6-5688-56f5-b68c-da66eb54d73f', 'tyrant-cnc-p365-sn-gm', 'Tyrant CNC P365 Snub Nose', 'Snub Nose Grip Module'),
    ('2a82e806-63d7-5dcc-85fc-a449a810934b', 'tyrant-cnc-p365-xmacro-gm', 'Tyrant CNC P365 XMacro', 'P365 XMacro Grip Module'),
    ('7d6d2ca7-e23e-5017-8726-775f8861c003', 'wilson-combat-wcp365', 'Wilson Combat WCP365 Grip Module', 'WCP365'),
    ('b7f9c263-f0f3-56f4-ab16-df8cbcbbbdc0', 'wilson-combat-wcp365-xl', 'Wilson Combat WCP365 XL Grip Module', 'WCP365 XL'),
    ('1a7464aa-d1a4-568c-b810-f7bd53902f9d', 'wilson-combat-wcp365-xmacro', 'Wilson Combat WCP365 XMacro Grip Module', 'WCP365 XMacro'),
    ('7e6e72ef-3de3-520a-ac5c-e693a20c47d5', 'wilson-combat-wcp365-xmacro-sg', 'Wilson Combat WCP365 XMacro Short Grip Module', 'WCP365 XMacro Short'),
    ('8f49d2a0-85d0-4b09-a3f3-63b4e063f1e8', 'olight-pl-x-gl', 'PL X GL', 'PL-X GL'),
    ('b3cf0a1d-39a8-57b5-be84-55eaea697211', 'surefire-x300t-a-turbo', 'X300T-A (Turbo)', 'X300T-A Turbo'),
    ('8aef49cd-440f-5079-861b-0f5aa95816c5', 'surefire-xc3', 'XC3 (XC3-A)', 'XC3'),
    ('0a01bfb4-d057-58f0-9706-cf78df89a1bb', 'align-tactical-offset-mag-release-p365', 'Align Tactical OFFSET P365 Extended Magazine Release', 'OFFSET Extended Magazine Release'),
    ('9dc5d83b-75e6-505b-9e98-b8efeb6a5f51', 'ecm-precision-extended-aggressive-mag-release-p365', 'ECM Precision Extended Aggressive OEM Style Mag Release', 'Extended Aggressive Magazine Release'),
    ('758fb1f0-59c5-5672-aeda-d354531d03dc', 'ecm-precision-extended-oem-mag-release-p365', 'ECM Precision Extended OEM Style Mag Release', 'Extended Magazine Release'),
    ('29bda9e5-e391-4e5b-8cfe-00a058065860', 'maskas-precision-mpi-mag-release-macro-frame-p365', 'MPI P365 Single Piece Extended Magazine Release - Macro Frame', 'Single Piece Extended Magazine Release (Macro Frame)'),
    ('a3030f20-a609-5731-a3d9-f0557979bbed', 'strike-industries-mag-release-p365', 'Strike Industries Magazine Release for SIG SAUER P365', 'P365 Magazine Release'),
    ('33302f65-e87c-5562-88c3-44aa744a37f0', 'strike-industries-mag-release-p365-xmacro', 'Strike Industries Mag Release for SIG P365 XMACRO', 'P365 XMacro Magazine Release'),
    ('329d19e2-ba1c-5706-ab4a-6f71cf337cb1', 'timber-creek-extended-mag-release-p365', 'Timber Creek Sig Sauer P365 Extended Magazine Release', 'Extended Magazine Release'),
    ('e071fafc-9a8b-5db7-8726-7d31bc72ab44', 'true-precision-stainless-mag-release-p365', 'True Precision Stainless Steel Extended Magazine Release for Sig Sauer ALL P365', 'Extended Magazine Release'),
    ('5eae3c6e-0eac-5b36-b118-2633ebad1ce7', 'tyrant-cnc-extended-mag-release-p365', 'Tyrant CNC P365 Extended Magazine Release', 'Extended Magazine Release'),
    ('15fe59ed-0d45-450a-8c9b-232ce17b661c', 'magpul-amag-10-sg9-p365-mag', 'AMAG 10 SG9 P365 9mm 10rd Magazine', 'AMAG 10 9mm 10rd Magazine'),
    ('0cebb073-0167-447c-93ad-9077ce5216e2', 'magpul-amag-12-sg9-p365-mag', 'AMAG 12 SG9 P365 9mm 12rd Magazine', 'AMAG 12 9mm 12rd Magazine'),
    ('d3409045-6298-4737-be25-3fc789a82735', 'magpul-amag-15-sg9-p365-mag', 'AMAG 15 SG9 P365 9mm 15rd Magazine', 'AMAG 15 9mm 15rd Magazine'),
    ('10328adb-00c8-413e-a6c2-0a564b5dbff5', 'magpul-amag-17-sg9-p365-mag', 'AMAG 17 SG9 P365 9mm 17rd Magazine', 'AMAG 17 9mm 17rd Magazine'),
    ('39dbd6bc-dcf3-4b16-8585-b05e7fd60c2a', 'sig-sauer-p365-17rd-mag', 'P365 9mm 17rd Magazine (All 9mm Models)', 'P365 9mm 17rd Magazine'),
    ('2a278c3e-b8fe-47ab-bc36-e59939d19587', 'sig-sauer-p365-axg-legion-17rd-mag', 'P365-AXG LEGION 9mm 17rd Magazine', 'P365 AXG Legion 9mm 17rd Magazine'),
    ('f279abd6-7f60-4a85-98c1-4ae68e3d196b', 'sig-sauer-p365-x-xl-10rd-mag', 'P365X/XL 9mm 10rd Flush Magazine', 'P365 XL 9mm 10rd Magazine'),
    ('f529a09a-ad90-40f2-b8b2-d755b44bfa62', 'sig-sauer-p365-x-xl-12rd-mag', 'P365/X/XL 9mm 12rd Magazine', 'P365 9mm 12rd Magazine'),
    ('5a75601f-9099-432c-a25b-e44f42ccefce', 'sig-sauer-p365-x-xl-15rd-mag', 'P365/X/XL 9mm 15rd Magazine', 'P365 9mm 15rd Magazine'),
    ('50925599-06f9-4e5b-a78e-5d3e53cad2c3', 'sig-sauer-p365-xmacro-10rd-mag', 'P365-XMACRO 9mm 10rd Magazine', 'P365 XMacro 9mm 10rd Magazine'),
    ('74c0049c-5fe7-5ab3-b18f-e6d1b7a3bfb3', 'tti-xmacro-completed-mag-w-basepad', 'TTI SIG X-MACRO Completed Magazine w/ Versatile Basepad', 'P365 XMacro 9mm 20rd Magazine'),
    ('d7f66747-3b16-4d58-84e5-e59d6f65ccc6', 'ecm-precision-carry-magwell-r11', 'ECM Precision Carry Magwell for R11 P365 Grip Modules', 'R11 Carry Magwell'),
    ('387d245a-b22a-4ead-aff1-d7f3691f4546', 'ecm-precision-standard-magwell-r11', 'ECM Precision Standard Magwell for R11 P365 Grip Modules', 'R11 Standard Magwell'),
    ('90305239-5a83-5f86-aac0-9e3918f7385f', 'herrington-arms-magwell-p365xmacro', 'Herrington Arms HA Magwell for P365 X Macro', 'P365 XMacro Magwell'),
    ('82d17dd2-1734-57d9-84a1-2d4d576a0a08', 'radian-backstrap-magwell-p365xmacro', 'Radian Weapons Backstrap + Magwell Combo for Sig P365 XMACRO', 'Backstrap + Magwell Combo'),
    ('8b4986f1-c1e4-5247-9052-9e68c2812a96', 'shalotek-flex-magwell-p365', 'ShaloTek FLEX Magwell', 'FLEX Magwell'),
    ('769147d3-f60e-529d-8347-b7b118c28870', 'sig-sauer-mag-funnel-p365xmacro', 'SIG SAUER P365-XMACRO Magazine Funnel - Black', 'P365 XMacro Magazine Funnel'),
    ('1a1ea54b-d57e-55b4-af6b-3e1acc822763', 'true-precision-magwell-p365xmacro', 'True Precision Stainless Steel Magwell for Sig Sauer P365 XMacro & FUSE', 'Magwell'),
    ('0cdfb9aa-c79e-5513-b22d-0e8925299426', 'tyrant-cnc-magwell-p365xmacro', 'Tyrant CNC Sig Sauer P365 XMacro Magwell', 'P365 XMacro Magwell'),
    ('7455e0f8-b900-4bd4-94eb-e9b08dee9f5b', 'aimpoint-acro-p2', 'Aimpoint ACRO P-2', 'ACRO P-2'),
    ('c941c7b8-3598-4604-a690-2afade8f16c6', 'eotech-eflx', 'EOTech EFLX', 'EFLX'),
    ('a77cf4cd-be21-442f-b4d7-204b83ada095', 'eotech-eflx-ce', 'EOTech EFLX CE', 'EFLX CE'),
    ('e74a19db-915f-4d75-954b-f9f34446aca6', 'holosun-407c-x3', 'Holosun 407C X3', '407C X3'),
    ('9772a62f-0251-43ec-9d41-52b7c531cf29', 'holosun-407comp', 'Holosun 407COMP', '407COMP'),
    ('b510c062-e80d-4a12-a839-19a904392c8a', 'holosun-407k-x2', 'Holosun 407K X2', '407K X2'),
    ('3d9e7751-7298-413a-8050-f67becc11b33', 'holosun-507-promax', 'Holosun 507 PROMAX', '507 PROMAX'),
    ('2e1dfa1b-2705-4b1b-824f-92d775fa015d', 'holosun-507c-x2', 'Holosun 507C X2', '507C X2'),
    ('72289c20-68a1-4b12-956b-ac91270cfb25', 'holosun-507c-x3', 'Holosun 507C X3', '507C X3'),
    ('4e5aebeb-2700-413b-a50c-14f230c18255', 'holosun-507comp', 'Holosun 507COMP', '507COMP'),
    ('58565b4c-2f76-42b1-bed0-04898e1c0e30', 'holosun-507k-x2', 'Holosun 507K X2', '507K X2'),
    ('b8857fa8-8fbf-49da-a14f-4d198f1c9c79', 'holosun-508t-x2', 'Holosun 508T X2', '508T X2'),
    ('243b8580-2971-4cef-81e5-784d03cf8361', 'holosun-eps', 'Holosun EPS', 'EPS'),
    ('361a34ea-6685-4945-89fd-e1404587f4e6', 'holosun-eps-carry', 'Holosun EPS Carry', 'EPS Carry'),
    ('fdc94146-b902-40cc-a440-c46f9c9b8b41', 'holosun-eps-core', 'Holosun EPS CORE', 'EPS CORE'),
    ('fd761168-6428-4f5a-8c93-7958852dbada', 'holosun-scs-carry-gr', 'Holosun SCS Carry GR', 'SCS Carry GR'),
    ('7b8e50bd-c1cb-464d-bddd-c5bbbdaf9402', 'leupold-deltapoint-pro', 'Leupold DeltaPoint Pro', 'DeltaPoint Pro'),
    ('d1434349-f8e7-4c7b-9667-c1ccecd7e7d8', 'osight-3moa', 'Osight 3 MOA', 'Osight'),
    ('ddb1d87f-91fc-4252-895a-96887830c753', 'sig-sauer-romeo-m17', 'Sig Sauer Romeo-M17', 'Romeo-M17'),
    ('bbd821b0-3d34-4f3c-a1f2-94f7a32a2e33', 'sig-sauer-romeo-mdc', 'Sig Sauer Romeo MDC', 'Romeo MDC'),
    ('e3f069d2-801b-4f28-8338-313a02b076ff', 'sig-sauer-romeo-rs-compact', 'Sig Sauer Romeo RS Compact', 'Romeo RS Compact'),
    ('50735fba-fb41-434e-97be-52e26d6becb6', 'sig-sauer-romeo-rs-pro', 'Sig Sauer Romeo RS Pro', 'Romeo RS Pro'),
    ('0450e013-ff52-414a-b92d-d9e20e4697c6', 'sig-sauer-romeo-x-compact', 'Sig Sauer Romeo X-Compact', 'Romeo-X Compact'),
    ('83e0b4f3-fdca-41ba-9b31-99ea482c083e', 'sig-sauer-romeo-x-enclosed-compact', 'Sig Sauer Romeo-X Enclosed Compact', 'Romeo-X Enclosed Compact'),
    ('39162b13-7814-460b-b154-b1558d06771d', 'sig-sauer-romeo-x-enclosed-pro', 'Sig Sauer Romeo-X Enclosed Pro', 'Romeo-X Enclosed Pro'),
    ('cb10c35e-55d5-43d3-9011-b22d95ed0658', 'sig-sauer-romeo-x-pro', 'Sig Sauer Romeo-X Pro', 'Romeo-X Pro'),
    ('8223d652-134d-466d-b5ed-50a1813e2583', 'sig-sauer-romeo-x-sigloc-compact', 'Sig Sauer Romeo-X SIG-LOC Compact', 'Romeo-X SIG-LOC Compact'),
    ('74ec796a-b9da-465d-9696-0431aae48bc9', 'sig-sauer-romeo-x-sigloc-pro', 'Sig Sauer Romeo-X SIG-LOC PRO', 'Romeo-X SIG-LOC Pro'),
    ('4f2b1642-c191-43f0-ba10-3ce637e5c626', 'sig-sauer-romeo1pro', 'Sig Sauer Romeo1Pro', 'Romeo1Pro'),
    ('c94e8c5f-cbd7-4df9-ae6d-9be20f6fe599', 'sig-sauer-romeo2', 'Sig Sauer Romeo2', 'Romeo2'),
    ('18448203-f706-42d0-afa2-17ea68b47331', 'sig-sauer-romeo2-large-shroud', 'Sig Sauer Romeo2 Large Shroud', 'Romeo2 Large Shroud'),
    ('c2d7467a-fc7f-4986-8a7a-c45dd627f677', 'sig-sauer-romeo3pro', 'Sig Sauer Romeo3Pro', 'Romeo3Pro'),
    ('85ffcf29-fa0a-4aa2-94fb-7e51dc6311e5', 'vortex-defender-ccw', 'Vortex Defender CCW', 'Defender CCW'),
    ('86963873-14f1-4371-8f6c-f9ce80fb1e42', 'vortex-defender-ccw-enclosed', 'Vortex Defender CCW Enclosed', 'Defender CCW Enclosed'),
    ('fc1c0149-f79d-485c-adcd-0fc56e0e3083', 'vortex-defender-st', 'Vortex Defender ST', 'Defender ST'),
    ('c01ac8d0-fd70-4265-a5f8-fbeb80ee7e75', 'vortex-defender-st-enclosed', 'Vortex Defender ST Enclosed', 'Defender ST Enclosed'),
    ('4a140a68-b95f-4fb4-ae4c-d5420861d7de', 'vortex-defender-xl', 'Vortex Defender XL', 'Defender XL'),
    ('0b4b3152-f0f2-4c19-ba45-9f861944bde1', 'vortex-venom-enclosed', 'Vortex Venom Enclosed', 'Venom Enclosed'),
    ('01535e4a-aa6f-4d7d-8457-9a6255e7df23', 'tactical-development-pro-ledge-tar-p365xmacro', 'Pro Ledge TAR for Sig P365 xMacro', 'Pro Ledge TAR'),
    ('244b46e1-5f14-4709-b3cb-6bf684722707', 'tactical-development-pro-ledge-tlr7-sub-1913-p365', 'Pro Ledge for TLR7 SUB-1913', 'Pro Ledge TLR7 Sub 1913'),
    ('9e69b463-c58e-4f14-903c-0c58a60777fd', 'dmp-springs-soft-rsa-p365', 'DMP Soft RSA', 'Soft RSA'),
    ('b8fc0afd-ec95-4604-83a6-f8bb6e84b473', 'ecm-precision-recoil-spring-kit-3-1-p365', 'ECM Precision P365 Recoil Spring Assembly 3.1 (3 Spring Kit)', 'Recoil Spring Assembly 3.1 Kit'),
    ('19bb7f26-1670-4f27-9f30-1b726e465ee2', 'ecm-precision-recoil-spring-kit-3-7-p365', 'ECM Precision P365 Recoil Spring Assembly 3.7 (3 Spring Kit)', 'Recoil Spring Assembly 3.7 Kit'),
    ('f63d74b2-4149-4417-9494-18a4af35d63a', 'ecm-precision-recoil-spring-kit-4-3-p365', 'ECM Precision P365 Recoil Spring Assembly 4.3 (3 Spring Kit)', 'Recoil Spring Assembly 4.3 Kit'),
    ('0a2c122d-4da0-4e81-82c3-70de255d1f54', 'armory-craft-ambi-extended-safety-p365', 'P365 - AMBI. EXTENDED Safety', 'Ambi Extended Safety'),
    ('c0928335-4521-5a87-809d-e751750f12f3', 'sig-sauer-manual-safety-kit-p365', 'SIG SAUER P365X Manual Safety Controls Parts Kit', 'P365X Manual Safety Controls Parts Kit'),
    ('6fac57ea-14d3-4ec5-9a06-393fc27a3894', 'sig-sauer-manual-safety-parts-kit-black-p365', 'P365 MANUAL SAFETY PARTS KIT - BLACK', 'P365 Manual Safety Parts Kit'),
    ('ca21b249-5214-5e57-89ec-e56403a4b2de', 'tyrant-cnc-safety-selector-p365', 'Tyrant CNC P365 Safety Selector', 'Safety Selector'),
    ('08c877ba-2344-4611-ad29-cda2f7416f14', 'angry-bear-arms-blank-sights-p365', 'Angry Bear Arms Blank Pistol Sights for Sig P365', 'Blank Sights'),
    ('8d888e7a-7f35-4e9f-8710-79be95b458c8', 'angry-bear-arms-fiber-optic-sights-p365', 'Angry Bear Arms Fiber Optic Pistol Sights for Sig P365', 'Fiber Optic Sights'),
    ('6a6cb615-1ecd-46bd-a14d-2595632c1a2e', 'night-fision-ors-night-sights-240-p365', 'Night Fision Optics Ready Stealth Night Sights for Sig P365 (.240/.238)', 'Optics Ready Stealth Night Sights .240/.238'),
    ('d6258b97-8931-4955-be1d-615af6a87c30', 'night-fision-ors-night-sights-289-p365', 'Night Fision Optics Ready Stealth Night Sights for Sig P365 (.289/.287)', 'Optics Ready Stealth Night Sights .289/.287'),
    ('9da822f4-0ca6-4f51-8399-71ccd2de6474', 'tag-precision-optic-ready-sights-p365', 'TAG Precision SIG P365 Optic Ready Sights', 'Optic Ready Sights'),
    ('4f7cc732-afba-4fa4-9f0e-de051667d4b0', 'tag-precision-tactical-sights-p365', 'TAG Precision SIG P365 Tactical Sights', 'Tactical Sights'),
    ('8c231107-016f-4d2d-bf01-5c3446870677', 'grey-ghost-precision-v1-p365', 'Grey Ghost Precision GGP365 V1', 'GGP365 V1'),
    ('e580b237-2cd8-4997-9e1b-f0201fd68211', 'grey-ghost-precision-v2-p365', 'Grey Ghost Precision GGP365 V2', 'GGP365 V2'),
    ('635fa806-3fc4-43f5-8722-db8f00e1f55a', 'killer-innovations-velo-v1-p365', 'Killer Innovations Velocity V1 Sig P365', 'Velocity V1 P365'),
    ('1ef5b218-9134-40ff-a395-0742fcaf3cd9', 'killer-innovations-velo-v1-p365-xl', 'Killer Innovations Velocity V1 Sig P365XL', 'Velocity V1 P365 XL'),
    ('67815957-6877-4281-8865-1eccd44b17aa', 'mcarbo-stainless-slide-ported-barrel-p365xl', 'P365 XL Stainless Compensated Slide with Ported Barrel', 'P365 XL Compensated Slide'),
    ('6beee244-ba36-44a7-ac8a-7dc77de65f64', 'norsso-barracuda-edc-p365-fuse', 'Norsso P365-FUSE Barracuda EDC', 'P365 FUSE Barracuda EDC'),
    ('6e5daa5b-4c8f-4aa4-b48b-df937c6ad1a9', 'norsso-bentham-p365', 'Norsso P365 Bentham', 'P365 Bentham'),
    ('31898686-037b-4fc3-8f46-d1d79c9d7373', 'norsso-bentham-p365-xl', 'Norsso P365XL Bentham', 'P365 XL Bentham'),
    ('cad2d837-4954-440d-a779-8c1d26ab5fb0', 'norsso-piranha-cport-p365-fuse', 'Norsso P365-FUSE Piranha C', 'P365 FUSE Piranha C'),
    ('3e636002-3e24-45d5-aa45-3f0451502989', 'norsso-rail-cport-p365-xl', 'Norsso P365XL Rail C', 'P365 XL Rail C'),
    ('64d7d835-32d1-4813-8876-89378e56501c', 'norsso-rail-edc-cport-p365', 'Norsso P365 Rail EDC C', 'P365 Rail EDC C'),
    ('1d37c289-d905-40b2-a2e2-ffbe253707ad', 'norsso-rail-edc-cport-p365-xl', 'Norsso P365XL Rail EDC C', 'P365 XL Rail EDC C'),
    ('6b3677b1-675e-4086-beed-be0ac19db1c9', 'norsso-rail-edc-n365dg-p365-xl', 'Norsso N365DG Rail EDC', 'N365DG Rail EDC'),
    ('05c069d4-dbf2-4883-bdf2-9b7e3ec4febd', 'norsso-rail-edc-n365dg-xp-p365-xl', 'Norsso N365DG Rail EDC XP', 'N365DG Rail EDC XP'),
    ('7714c325-265f-4e98-90b9-88f93ae77f56', 'norsso-rail-edc-p365', 'Norsso P365 Rail EDC', 'P365 Rail EDC'),
    ('c1cc49b1-79f2-410d-bcea-6e99e6147dfc', 'norsso-rail-edc-p365-fuse', 'Norsso P365-FUSE Rail EDC', 'P365 FUSE Rail EDC'),
    ('99f6e2e2-0e62-454e-8a3c-040caeca05be', 'norsso-rail-edc-p365-xl', 'Norsso P365XL Rail EDC', 'P365 XL Rail EDC'),
    ('2d19be25-bdb9-489e-90e3-d32ff0354236', 'norsso-rail-kp-p365-fuse', 'Norsso P365-FUSE Rail KP', 'P365 FUSE Rail KP'),
    ('ce362eec-d486-4be5-8c9d-e1bdd1a8f95d', 'norsso-rail-n365dg-p365-xl', 'Norsso N365DG Rail', 'N365DG Rail'),
    ('04a69aca-e315-427f-aae1-af5036806699', 'norsso-rail-p365-xl', 'Norsso P365XL Rail', 'P365 XL Rail'),
    ('3624e755-4ea9-4660-a0d6-f3ed5faa0ef2', 'norsso-reptile-cport-p365', 'Norsso P365 Reptile C', 'P365 Reptile C'),
    ('9e391b86-133f-4eca-97ee-d4ffcf8eed0a', 'norsso-reptile-cport-p365-fuse', 'Norsso P365-FUSE Reptile C', 'P365 FUSE Reptile C'),
    ('5109c9c9-85d2-4034-9228-60a64b0c8bd6', 'norsso-reptile-cport-p365-xl', 'Norsso P365XL Reptile C', 'P365 XL Reptile C'),
    ('0d5efc4e-af81-4ebb-92cb-3044d77fad46', 'norsso-reptile-edc-p365', 'Norsso P365 Reptile EDC', 'P365 Reptile EDC'),
    ('78a0e895-1530-4f21-a16b-ffe9f8d062ad', 'norsso-reptile-edc-p365-fuse', 'Norsso P365-FUSE Reptile EDC', 'P365 FUSE Reptile EDC'),
    ('04f17eb9-7bd7-4479-b100-f1c359660f72', 'norsso-reptile-edc-p365-xl', 'Norsso P365XL Reptile EDC', 'P365 XL Reptile EDC'),
    ('51484e38-99d0-4af0-8613-b9df2994ae86', 'norsso-reptile-kp-p365-fuse', 'Norsso P365-FUSE Reptile KP', 'P365 FUSE Reptile KP'),
    ('3d389ac8-33f4-41f2-83c7-9ef3a7fa156b', 'norsso-reptile-n365dg-xp-p365-xl', 'Norsso N365DG Reptile XP', 'N365DG Reptile XP'),
    ('457729e7-6c9d-48b6-8d5c-9f334b9572cc', 'norsso-reptile-og-n365dg-p365-xl', 'Norsso N365DG Reptile OG', 'N365DG Reptile OG'),
    ('01878f61-20de-4c3d-ab22-5a3052c82144', 'norsso-reptile-og-p365', 'Norsso P365 Reptile OG', 'P365 Reptile OG'),
    ('dc0770f9-9c25-41cf-9808-81a9cd650a91', 'norsso-reptile-og-p365-xl', 'Norsso P365XL Reptile OG', 'P365 XL Reptile OG'),
    ('f0a563dc-27e2-4993-a43e-6084c45b2e5d', 'norsso-spec-ops-bull-barrel-ported-set-p365-xl', 'Norsso N365XL Bull Barrel Spec Ops Ported Set', 'N365XL Bull Barrel Spec Ops Ported Set'),
    ('2820bdcb-9a23-45c9-9688-96086af2cacc', 'norsso-spec-ops-cport-p365', 'Norsso P365 Spec Ops C', 'P365 Spec Ops C'),
    ('d7ca1789-9ce4-4048-8368-ed30ff498187', 'norsso-spec-ops-cport-p365-xl', 'Norsso P365XL Spec Ops C', 'P365 XL Spec Ops C'),
    ('7c4c4df6-ed23-4a4b-a477-7244f2bdaa60', 'norsso-spec-ops-n365dg-p365-xl', 'Norsso N365DG Spec Ops', 'N365DG Spec Ops'),
    ('6726008a-a76e-4dab-b24f-95c9a47b1ff1', 'norsso-spec-ops-p365', 'Norsso P365 Spec Ops', 'P365 Spec Ops'),
    ('881298eb-85ad-4e66-ad4e-13fe6e754269', 'norsso-spec-ops-p365-xl', 'Norsso P365XL Spec Ops', 'P365 XL Spec Ops'),
    ('dfc75d0f-d103-44ae-ba2d-a8bf15e5e0f9', 'true-precision-axiom-p365', 'True Precision Axiom P365', 'Axiom P365'),
    ('08e15a9b-4bd0-4bc1-baef-0822a027e1ad', 'true-precision-axiom-p365-xl', 'True Precision Axiom P365XL', 'Axiom P365 XL'),
    ('04628757-d54f-4bba-b288-435b7bb74351', 'true-precision-p365-fuse', 'True Precision P365-FUSE', 'P365 FUSE Slide'),
    ('6608f4b9-40ce-42f3-938a-f68071f503f3', 'zaffiri-zps2-p365-xl', 'Zaffiri Precision ZPS.2 P365XL', 'ZPS.2 P365 XL'),
    ('50a9d099-2061-4740-9ddf-27b6cfff4dc9', 'zaffiri-zpsp-p365-xl', 'Zaffiri Precision ZPS.P Ported P365XL', 'ZPS.P Ported P365 XL'),
    ('e75ec946-b467-59ed-9c38-43111d64d8c7', 'anarchy-outdoors-slide-plate-p365', 'Anarchy Outdoors Slide Plate for Sig 365', 'Slide Plate'),
    ('bf7579cc-3f90-50e2-afff-aa2418544859', 'true-precision-slide-cap-p365', 'True Precision Stainless Steel Slide Cap Textured Back Plate', 'Textured Slide Cap'),
    ('7161306d-f2b1-5618-a791-9466237fd6a2', 'tyrant-cnc-slide-cap-p365', 'Tyrant CNC Sig Sauer P365 Slide Cap', 'Slide Cap'),
    ('3d16ba21-a43c-5098-9404-cf545f548b3b', 'armory-craft-ext-slide-release-p365', 'Armory Craft P365 Extended Slide Release', 'Extended Slide Release'),
    ('34cebf07-3ccd-4512-9569-2ee0bb4099ef', 'sig-sauer-extended-slide-catch-lever-black-p365', 'P365 EXTENDED SLIDE CATCH LEVER-BLACK', 'P365 Extended Slide Catch Lever'),
    ('d097691f-7bce-5ad6-b315-605e4b4252cb', 'tyrant-cnc-ext-slide-catch-p365', 'Tyrant CNC P365 Extended Slide Catch Lever', 'Extended Slide Catch Lever'),
    ('0d0e68bf-3640-56d0-9613-15230f71f2c2', 'align-tactical-thumb-rest-takedown-p365', 'Align Tactical P365 Thumb Rest Takedown Lever', 'Thumb Rest Takedown Lever'),
    ('9cf18dbe-2336-52d8-abca-0b503188c0f6', 'tyrant-cnc-takedown-lever-p365', 'Tyrant CNC SIG SAUER P365 Takedown Lever', 'Takedown Lever'),
    ('cc991e84-7493-5125-ab4e-4b8626c7c25b', 'mcarbo-short-stroke-flat-p365', 'MCARBO Short Stroke Flat Trigger', 'Short Stroke Flat Trigger'),
    ('4754b550-2a84-493f-b72d-a734fd78096d', 'ramm-tactical-leverage-trigger-p365', 'Ramm Tactical Leverage P365', 'Leverage Trigger'),
    ('2b160547-c1c8-5970-bdf7-16bfc7d986e0', 'sig-sauer-curved-p365', 'Sig Sauer Curved P365', 'P365 Curved Trigger'),
    ('6cfecc5c-080d-5021-99bb-cd0f48f73f0e', 'sig-sauer-flat-oem-p365', 'Sig Sauer Flat OEM P365', 'P365 Flat Trigger'),
    ('af2121d3-6e19-5e11-bed3-2ef0a74ec58c', 'tactical-development-dual-flat-face-p365', 'Tactical Development Enhanced Dual Flat Faced', 'Enhanced Dual Flat Faced Trigger'),
    ('6c97a18f-18a4-5377-99f1-42c4623a0d76', 'true-precision-flat-p365', 'True Precision Flat P365', 'Flat Trigger'),
    ('c36ab318-9db0-53e1-a41c-9ba1181371b3', 'tyrant-cnc-intellifire-p365', 'Tyrant CNC P365 Intellifire Trigger', 'Intellifire Trigger');

  select count(*) into n_present
    from public.products p join naming_convention n on n.id = p.id;

  if n_present = 0 then
    raise notice 'product naming convention: none of the % listed products exist here (a fresh database) — nothing to rename', n_listed;
    return;
  end if;
  if n_present <> n_listed then
    raise exception 'product naming convention: % of % listed products exist here — not the catalog this file was written against', n_present, n_listed;
  end if;

  select count(*), string_agg(p.slug || ' (' || p.name || ')', '; ')
    into n_bad, bad_rows
    from public.products p join naming_convention n on n.id = p.id
   where p.slug <> n.slug or (p.name <> n.old_name and p.name <> n.new_name);
  if n_bad > 0 then
    raise exception 'product naming convention: % product(s) changed since the 2026-10-20 review, refusing to overwrite: %', n_bad, bad_rows;
  end if;

  update public.products p
     set name = n.new_name
    from naming_convention n
   where n.id = p.id and p.slug = n.slug and p.name = n.old_name;
  get diagnostics n_renamed = row_count;

  select count(*), string_agg(p.slug || ' (' || p.name || ')', '; ')
    into n_bad, bad_rows
    from public.products p join naming_convention n on n.id = p.id
   where p.name <> n.new_name;
  if n_bad > 0 then
    raise exception 'product naming convention: % listed product(s) still not carrying the new name: %', n_bad, bad_rows;
  end if;

  select count(*), string_agg(p.slug || ' (' || p.name || ' / ' || m.name || ')', '; ')
    into n_bad, bad_rows
    from public.products p join public.manufacturers m on m.id = p.brand_id
   where p.is_discontinued = false
     and (lower(p.name) = lower(m.name) or lower(p.name) like lower(m.name) || ' %');
  if n_bad > 0 then
    raise exception 'product naming convention: % live product name(s) still open with their brand: %', n_bad, bad_rows;
  end if;

  raise notice 'product naming convention: % of % listed products renamed (% already carried the new name)', n_renamed, n_listed, n_listed - n_renamed;
end $$;
