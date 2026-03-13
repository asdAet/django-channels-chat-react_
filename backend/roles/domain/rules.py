"""Pure domain rules for role permissions and hierarchy checks."""

from __future__ import annotations

from collections.abc import Iterable

from roles.permissions import Perm

SYSTEM_PROTECTED_ROLE_NAMES = frozenset({"@everyone", "Owner"})


def parse_direct_pair_key(pair_key: str | None) -> tuple[int, int] | None:
    """Parses `direct_pair_key` into two user ids."""
    if not pair_key or ":" not in pair_key:
        return None
    first, second = pair_key.split(":", 1)
    try:
        return int(first), int(second)
    except (TypeError, ValueError):
        return None


def direct_access_allowed(
    *,
    user_id: int | None,
    pair: tuple[int, int] | None,
    membership_user_ids: set[int],
    banned_user_ids: set[int],
) -> bool:
    """Checks strict DM access invariant: pair_key + membership + not banned."""
    if user_id is None or pair is None:
        return False
    if user_id not in pair:
        return False
    if user_id not in membership_user_ids:
        return False
    if user_id in banned_user_ids:
        return False
    return True


def resolve_permissions(
    *,
    everyone_permissions: int,
    role_permissions: Iterable[int],
    role_overrides: Iterable[tuple[int, int]],
    user_overrides: Iterable[tuple[int, int]],
) -> Perm:
    """Resolves effective permissions using Discord-style precedence."""
    permissions = Perm(int(everyone_permissions))
    for role_perm in role_permissions:
        permissions |= Perm(int(role_perm))

    if permissions & Perm.ADMINISTRATOR:
        return Perm(-1)

    role_allow = 0
    role_deny = 0
    for allow, deny in role_overrides:
        role_allow |= int(allow)
        role_deny |= int(deny)
    permissions = Perm((int(permissions) & ~role_deny) | role_allow)

    for allow, deny in user_overrides:
        permissions = Perm((int(permissions) & ~int(deny)) | int(allow))

    if permissions & Perm.ADMINISTRATOR:
        return Perm(-1)
    return permissions


def is_permission_subset(*, candidate: int, holder: int) -> bool:
    """True when all candidate bits are included in holder bits."""
    holder_perm = Perm(int(holder))
    if holder_perm & Perm.ADMINISTRATOR:
        return True
    return (int(candidate) & ~int(holder_perm)) == 0


def can_manage_target(*, actor_top_position: int, target_position: int) -> bool:
    """Hierarchy rule: actor can only manage roles strictly below self."""
    return int(actor_top_position) > int(target_position)


def normalize_role_ids(raw_role_ids: Iterable[int | str]) -> list[int]:
    """Normalizes list of positive role ids while preserving input order."""
    result: list[int] = []
    seen: set[int] = set()
    for value in raw_role_ids:
        try:
            role_id = int(value)
        except (TypeError, ValueError):
            continue
        if role_id < 1 or role_id in seen:
            continue
        seen.add(role_id)
        result.append(role_id)
    return result


def validate_override_target_ids(target_role_id: int | None, target_user_id: int | None) -> bool:
    """True when exactly one override target is provided."""
    return (target_role_id is None) ^ (target_user_id is None)


def has_manage_roles(permissions: int) -> bool:
    """Checks MANAGE_ROLES bit in effective permissions."""
    return bool(Perm(int(permissions)) & Perm.MANAGE_ROLES)


def role_is_protected(*, is_default: bool, name: str) -> bool:
    """Returns True for system roles that cannot be removed/broken."""
    return bool(is_default or name in SYSTEM_PROTECTED_ROLE_NAMES)
