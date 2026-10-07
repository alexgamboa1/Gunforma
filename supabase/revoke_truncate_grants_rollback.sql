-- Rollback for revoke_truncate_grants.sql — restores TRUNCATE for
-- authenticated on exactly the 64 relations that held it on 2026-10-06, and
-- the postgres default-ACL entry. anon held none, so nothing is restored for
-- anon. Only run this if something that needed TRUNCATE as authenticated
-- turns up; nothing found before the change did.

begin;

grant truncate on
  public._archive_products_specs, public.adapter_part_types, public.adapter_parts,
  public.affiliate_links, public.barrel_slide_requirements, public.barrel_specs,
  public.basepad_specs, public.basepad_types, public.build_fires,
  public.build_part_flags, public.build_photos, public.builds, public.calibers,
  public.clamp_styles, public.colors, public.compensator_specs, public.footprints,
  public.frame_specs, public.grip_rail_types, public.guides, public.guns,
  public.handedness_types, public.housing_classes, public.light_compatibility,
  public.light_specs, public.mag_release_specs, public.mag_types,
  public.magazine_families, public.magwell_frame_requirements, public.magwell_specs,
  public.manufacturers, public.materials, public.optic_adapter_footprints,
  public.optic_cut_footprints, public.optic_cuts, public.optic_specs,
  public.part_classes, public.part_favorites, public.partners,
  public.platform_part_lengths, public.platform_skus, public.platforms,
  public.port_styles, public.product_internal, public.product_platforms,
  public.product_variants, public.products, public.profiles, public.rail_bridge,
  public.rail_types, public.safety_selector_specs, public.saved_builds,
  public.slide_release_specs, public.slide_specs, public.takedown_lever_specs,
  public.trigger_specs, public.variant_images,
  public.v_barrel_slide_fit, public.v_comp_barrel_fit, public.v_frame_fitment,
  public.v_frame_light_fit, public.v_optic_slide_variant_fit,
  public.v_product_pricing, public.v_slide_frame_fit
to authenticated;

alter default privileges for role postgres in schema public
  grant truncate on tables to authenticated;

commit;
