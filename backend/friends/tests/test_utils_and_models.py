from types import SimpleNamespace
from typing import cast

from django.contrib.auth import get_user_model
from django.test import TestCase

from friends.models import Friendship
from friends.utils import get_from_user_id, get_to_user_id

User = get_user_model()


class FriendsUtilsTests(TestCase):
    def test_get_from_user_id_prefers_direct_id(self):
        obj = cast(Friendship, SimpleNamespace(from_user_id=10, from_user=SimpleNamespace(pk=99)))
        self.assertEqual(get_from_user_id(obj), 10)

    def test_get_from_user_id_falls_back_to_related_pk_or_none(self):
        with_pk = cast(Friendship, SimpleNamespace(from_user_id=None, from_user=SimpleNamespace(pk=11)))
        without_pk = cast(Friendship, SimpleNamespace(from_user_id=None, from_user=None))
        self.assertEqual(get_from_user_id(with_pk), 11)
        self.assertIsNone(get_from_user_id(without_pk))

    def test_get_to_user_id_prefers_direct_id(self):
        obj = cast(Friendship, SimpleNamespace(to_user_id=20, to_user=SimpleNamespace(pk=77)))
        self.assertEqual(get_to_user_id(obj), 20)

    def test_get_to_user_id_falls_back_to_related_pk_or_none(self):
        with_pk = cast(Friendship, SimpleNamespace(to_user_id=None, to_user=SimpleNamespace(pk=21)))
        without_pk = cast(Friendship, SimpleNamespace(to_user_id=None, to_user=None))
        self.assertEqual(get_to_user_id(with_pk), 21)
        self.assertIsNone(get_to_user_id(without_pk))


class FriendshipModelStringTests(TestCase):
    def test_str_uses_fk_ids_when_available(self):
        from_user = User.objects.create_user(username="f_from", password="pass12345")
        to_user = User.objects.create_user(username="f_to", password="pass12345")
        friendship = Friendship(from_user=from_user, to_user=to_user, status=Friendship.Status.PENDING)
        self.assertEqual(str(friendship), f"{from_user.pk}->{to_user.pk}:{Friendship.Status.PENDING}")

    def test_str_falls_back_to_placeholders_when_relations_missing(self):
        friendship = Friendship(status=Friendship.Status.ACCEPTED)
        self.assertEqual(str(friendship), f"?->?:{Friendship.Status.ACCEPTED}")
