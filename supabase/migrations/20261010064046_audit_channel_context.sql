begin;

alter table public.channel_listings
  add constraint channel_listings_workspace_channel_id_key unique (workspace_id, channel_id, id);

alter table public.audit_issues add column channel_id uuid;

alter table public.audit_issues
  add constraint audit_issues_channel_fkey foreign key (workspace_id, channel_id)
    references public.channels(workspace_id, id) on delete cascade,
  add constraint audit_issues_channel_listing_fkey foreign key (workspace_id, channel_id, listing_id)
    references public.channel_listings(workspace_id, channel_id, id) on delete cascade;

update public.audit_issues issue set channel_id = listing.channel_id
from public.channel_listings listing
where listing.id = issue.listing_id and listing.workspace_id = issue.workspace_id;

create index audit_issues_workspace_channel_idx
  on public.audit_issues(workspace_id, channel_id) where channel_id is not null;

comment on column public.audit_issues.channel_id is
  'Target channel, including MISSING_CHANNEL issues that have no listing. Product-wide issues may leave this null.';

commit;
