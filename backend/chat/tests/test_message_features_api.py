"""API coverage for message payload/reactions/search/attachments features."""

from __future__ import annotations

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from chat.services import MessageForbiddenError
from messages.models import Message, Reaction
from rooms.models import Room
from rooms.services import ensure_membership
from users.identity import ensure_profile

User = get_user_model()


class ChatMessageFeatureApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.owner = User.objects.create_user(username="owner_feat", password="pass12345")
        self.peer = User.objects.create_user(username="peer_feat", password="pass12345")
        self.outsider = User.objects.create_user(username="outsider_feat", password="pass12345")
        owner_profile = ensure_profile(self.owner)
        owner_profile.username = self.owner.username
        owner_profile.save(update_fields=["username"])
        peer_profile = ensure_profile(self.peer)
        peer_profile.username = self.peer.username
        peer_profile.save(update_fields=["username"])
        outsider_profile = ensure_profile(self.outsider)
        outsider_profile.username = self.outsider.username
        outsider_profile.save(update_fields=["username"])

        self.direct_room = Room.objects.create(
            slug="dm_features_01",
            name="dm features",
            kind=Room.Kind.DIRECT,
            direct_pair_key=f"{self.owner.pk}:{self.peer.pk}",
            created_by=self.owner,
        )
        ensure_membership(self.direct_room, self.owner)
        ensure_membership(self.direct_room, self.peer)

    def test_reactions_allowed_in_direct_room(self):
        message = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="reaction target",
        )
        self.client.force_login(self.owner)

        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/reactions/",
            data=json.dumps({"emoji": "\U0001F44D"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            Reaction.objects.filter(
                message=message,
                user=self.owner,
                emoji="\U0001F44D",
            ).exists()
        )

    def test_global_search_respects_interaction_scope_for_all_sections(self):
        visible_group = Room.objects.create(
            slug="group_features_01",
            name="scope visible group",
            kind=Room.Kind.GROUP,
            is_public=False,
            username="scope_visible_group",
            created_by=self.owner,
        )
        ensure_membership(visible_group, self.owner, role_name="Owner")

        scope_friend = User.objects.create_user(username="scope_friend", password="pass12345")
        scope_friend_profile = ensure_profile(scope_friend)
        scope_friend_profile.username = scope_friend.username
        scope_friend_profile.save(update_fields=["username"])
        ensure_membership(visible_group, scope_friend, role_name="Member")

        hidden_group = Room.objects.create(
            slug="group_features_hidden",
            name="scope hidden group",
            kind=Room.Kind.GROUP,
            is_public=False,
            username="scope_hidden_group",
            created_by=self.outsider,
        )
        ensure_membership(hidden_group, self.outsider, role_name="Owner")

        hidden_scope_user = User.objects.create_user(username="scope_hidden", password="pass12345")
        hidden_scope_profile = ensure_profile(hidden_scope_user)
        hidden_scope_profile.username = hidden_scope_user.username
        hidden_scope_profile.save(update_fields=["username"])
        ensure_membership(hidden_group, hidden_scope_user, role_name="Member")

        visible_msg = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="scope visible message",
        )
        hidden_msg = Message.objects.create(
            username=self.outsider.username,
            user=self.outsider,
            room=hidden_group,
            message_content="scope hidden message",
        )

        self.client.force_login(self.owner)
        response = self.client.get("/api/chat/search/global/?q=@scope")
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertIn("users", payload)
        self.assertIn("groups", payload)
        self.assertIn("messages", payload)

        found_usernames = {item["username"] for item in payload["users"]}
        self.assertIn(scope_friend.username, found_usernames)
        self.assertNotIn(hidden_scope_user.username, found_usernames)

        found_group_slugs = {item["slug"] for item in payload["groups"]}
        self.assertIn(visible_group.slug, found_group_slugs)
        self.assertNotIn(hidden_group.slug, found_group_slugs)

        found_message_ids = {item["id"] for item in payload["messages"]}
        self.assertIn(visible_msg.pk, found_message_ids)
        self.assertNotIn(hidden_msg.pk, found_message_ids)
        self.assertFalse(any("hidden" in item["content"] for item in payload["messages"]))

    def test_global_search_plain_text_returns_messages_only(self):
        visible_group = Room.objects.create(
            slug="group_plain_text_scope",
            name="plain text scope group",
            kind=Room.Kind.GROUP,
            is_public=True,
            username="plain_scope_group",
            created_by=self.owner,
        )
        ensure_membership(visible_group, self.owner, role_name="Owner")

        visible_msg = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="plain_scope message",
        )

        self.client.force_login(self.owner)
        response = self.client.get("/api/chat/search/global/?q=plain_scope")
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        self.assertEqual(payload["users"], [])
        self.assertEqual(payload["groups"], [])
        self.assertIn(visible_msg.pk, {item["id"] for item in payload["messages"]})

    def test_global_search_includes_any_matching_public_groups_without_interaction(self):
        public_group_one = Room.objects.create(
            slug="group_public_visible_one",
            name="Catalog Group One",
            kind=Room.Kind.GROUP,
            is_public=True,
            username="catalog_group_one",
            created_by=self.outsider,
        )
        ensure_membership(public_group_one, self.outsider, role_name="Owner")

        public_group_two = Room.objects.create(
            slug="group_public_visible_two",
            name="Catalog Group Two",
            kind=Room.Kind.GROUP,
            is_public=True,
            username="catalog_group_two",
            created_by=self.peer,
        )
        ensure_membership(public_group_two, self.peer, role_name="Owner")

        private_group = Room.objects.create(
            slug="group_private_catalog",
            name="Catalog Private Group",
            kind=Room.Kind.GROUP,
            is_public=False,
            username="catalog_private_group",
            created_by=self.outsider,
        )
        ensure_membership(private_group, self.outsider, role_name="Owner")

        self.client.force_login(self.owner)
        response = self.client.get("/api/chat/search/global/?q=@catalog")
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        found_group_slugs = {item["slug"] for item in payload["groups"]}
        self.assertIn(public_group_one.slug, found_group_slugs)
        self.assertIn(public_group_two.slug, found_group_slugs)
        self.assertNotIn(private_group.slug, found_group_slugs)

    def test_global_search_handle_excludes_public_group_without_username(self):
        public_group = Room.objects.create(
            slug="group_public_without_username",
            name="Catalog Group No Handle",
            kind=Room.Kind.GROUP,
            is_public=True,
            created_by=self.outsider,
        )
        ensure_membership(public_group, self.outsider, role_name="Owner")

        self.client.force_login(self.owner)
        response = self.client.get("/api/chat/search/global/?q=@catalog")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        found_group_slugs = {item["slug"] for item in payload["groups"]}
        self.assertNotIn(public_group.slug, found_group_slugs)

    def test_global_search_supports_handle_query_for_group_username(self):
        group_username = "public_handle_group"
        public_group = Room.objects.create(
            slug="group_public_handle",
            name="Another public group",
            kind=Room.Kind.GROUP,
            is_public=True,
            username=group_username,
            created_by=self.outsider,
        )
        ensure_membership(public_group, self.outsider, role_name="Owner")

        self.client.force_login(self.owner)
        response = self.client.get(f"/api/chat/search/global/?q=@{group_username}")
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        found_group_slugs = {item["slug"] for item in payload["groups"]}
        self.assertIn(public_group.slug, found_group_slugs)

    def test_global_search_supports_handle_query_for_updated_username(self):
        peer_profile = ensure_profile(self.peer)
        peer_profile.username = "peerfeatureupdated"
        peer_profile.save(update_fields=["username"])

        self.client.force_login(self.owner)
        response = self.client.get("/api/chat/search/global/?q=@peerfeatureupdated")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        found_usernames = {item["username"] for item in payload["users"]}
        self.assertIn("peerfeatureupdated", found_usernames)

    def test_attachment_upload_accepts_reply_to_and_get_lists_items(self):
        reply_target = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="reply target",
        )
        self.client.force_login(self.owner)

        upload_file = SimpleUploadedFile(
            "note.txt",
            b"hello attachment",
            content_type="text/plain",
        )
        post_response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={
                "files": [upload_file],
                "messageContent": "file message",
                "replyTo": str(reply_target.pk),
            },
        )
        self.assertEqual(post_response.status_code, 201)
        created_id = post_response.json()["id"]
        created_message = Message.objects.get(pk=created_id)
        self.assertEqual(created_message.reply_to_id, reply_target.pk)

        get_response = self.client.get(f"/api/chat/rooms/{self.direct_room.slug}/attachments/")
        self.assertEqual(get_response.status_code, 200)
        items = get_response.json()["items"]
        self.assertTrue(any(item["messageId"] == created_id for item in items))

    @override_settings(CHAT_ATTACHMENT_ALLOWED_TYPES=["text/plain"])
    def test_attachment_upload_rejects_unsupported_content_type_with_code(self):
        self.client.force_login(self.owner)
        upload_file = SimpleUploadedFile(
            "archive.bin",
            b"\x00\x01\x02\x03",
            content_type="application/x-custom-binary",
        )
        post_response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={"files": [upload_file]},
        )

        self.assertEqual(post_response.status_code, 400)
        payload = post_response.json()
        self.assertEqual(payload["code"], "unsupported_type")
        self.assertIn("allowedTypes", payload["details"])

    def test_attachment_upload_accepts_file_key_compat(self):
        self.client.force_login(self.owner)
        upload_file = SimpleUploadedFile(
            "note.txt",
            b"legacy key file",
            content_type="text/plain",
        )
        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={"file": upload_file},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.json()["attachments"]), 1)

    def test_attachment_upload_accepts_attachments_array_key_compat(self):
        self.client.force_login(self.owner)
        upload_file = SimpleUploadedFile(
            "note-array.txt",
            b"legacy array key file",
            content_type="text/plain",
        )
        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={"attachments[]": [upload_file]},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.json()["attachments"]), 1)

    def test_attachment_upload_accepts_attachments_key_compat(self):
        self.client.force_login(self.owner)
        upload_file = SimpleUploadedFile(
            "note-compat.txt",
            b"legacy attachments key file",
            content_type="text/plain",
        )
        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={"attachments": [upload_file]},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.json()["attachments"]), 1)

    def test_attachment_upload_returns_code_when_files_missing(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "no_files")

    @override_settings(CHAT_ATTACHMENT_MAX_PER_MESSAGE=1)
    def test_attachment_upload_returns_code_when_too_many_files(self):
        self.client.force_login(self.owner)
        file_one = SimpleUploadedFile("one.txt", b"1", content_type="text/plain")
        file_two = SimpleUploadedFile("two.txt", b"2", content_type="text/plain")
        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={"files": [file_one, file_two]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "too_many_files")

    def test_attachment_upload_returns_code_for_invalid_reply(self):
        self.client.force_login(self.owner)
        upload_file = SimpleUploadedFile("reply.txt", b"file", content_type="text/plain")
        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={"files": [upload_file], "replyTo": "999999"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_reply_to")

    @override_settings(CHAT_ATTACHMENT_MAX_SIZE_MB=1)
    def test_attachment_upload_returns_code_when_file_too_large(self):
        self.client.force_login(self.owner)
        large_payload = b"x" * (2 * 1024 * 1024)
        upload_file = SimpleUploadedFile(
            "large.txt",
            large_payload,
            content_type="text/plain",
        )
        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={"files": [upload_file]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "file_too_large")

    @override_settings(CHAT_ATTACHMENT_ALLOWED_TYPES=["audio/mpeg"])
    def test_attachment_upload_normalizes_audio_mp3_alias(self):
        self.client.force_login(self.owner)
        upload_file = SimpleUploadedFile(
            "voice.mp3",
            b"ID3\x03\x00\x00\x00\x00\x00\x00",
            content_type="audio/mp3",
        )
        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/attachments/",
            data={"files": [upload_file]},
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["attachments"][0]["contentType"], "audio/mpeg")

    def test_mark_read_is_monotonic_and_persisted_in_room_details(self):
        first_message = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="first unread",
        )
        second_message = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="second unread",
        )
        self.client.force_login(self.owner)

        first_read_response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/read/",
            data=json.dumps({"lastReadMessageId": second_message.pk}),
            content_type="application/json",
        )
        self.assertEqual(first_read_response.status_code, 200)
        self.assertEqual(first_read_response.json()["lastReadMessageId"], second_message.pk)

        backward_response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/read/",
            data=json.dumps({"lastReadMessageId": first_message.pk}),
            content_type="application/json",
        )
        self.assertEqual(backward_response.status_code, 200)
        self.assertEqual(backward_response.json()["lastReadMessageId"], second_message.pk)

        details_response = self.client.get(f"/api/chat/rooms/{self.direct_room.slug}/")
        self.assertEqual(details_response.status_code, 200)
        self.assertEqual(details_response.json()["lastReadMessageId"], second_message.pk)

    def test_mark_read_accepts_form_payload_for_keepalive_flush(self):
        message = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="form-data mark read",
        )
        self.client.force_login(self.owner)

        response = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/read/",
            data={"lastReadMessageId": str(message.pk)},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["lastReadMessageId"], message.pk)

    def test_message_detail_patch_validates_content_type_and_empty_value(self):
        message = Message.objects.create(
            username=self.owner.username,
            user=self.owner,
            room=self.direct_room,
            message_content="initial",
        )
        self.client.force_login(self.owner)

        not_string = self.client.patch(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/",
            data=json.dumps({"content": 123}),
            content_type="application/json",
        )
        self.assertEqual(not_string.status_code, 400)

        empty = self.client.patch(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/",
            data=json.dumps({"content": "   "}),
            content_type="application/json",
        )
        self.assertEqual(empty.status_code, 400)

    def test_message_detail_patch_and_delete_cover_success_and_not_found(self):
        message = Message.objects.create(
            username=self.owner.username,
            user=self.owner,
            room=self.direct_room,
            message_content="initial",
        )
        self.client.force_login(self.owner)

        patch_response = self.client.patch(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/",
            data=json.dumps({"content": "updated"}),
            content_type="application/json",
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()["content"], "updated")

        not_found = self.client.patch(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/999999/",
            data=json.dumps({"content": "x"}),
            content_type="application/json",
        )
        self.assertEqual(not_found.status_code, 404)

        delete_response = self.client.delete(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/"
        )
        self.assertEqual(delete_response.status_code, 204)
        message.refresh_from_db()
        self.assertTrue(message.is_deleted)

    def test_message_detail_delete_returns_forbidden_for_non_author(self):
        message = Message.objects.create(
            username=self.owner.username,
            user=self.owner,
            room=self.direct_room,
            message_content="cant delete by peer",
        )
        self.client.force_login(self.peer)

        response = self.client.delete(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/"
        )
        self.assertEqual(response.status_code, 403)

    def test_message_reactions_handles_forbidden_and_remove_flow(self):
        message = Message.objects.create(
            username=self.owner.username,
            user=self.owner,
            room=self.direct_room,
            message_content="reactions",
        )
        self.client.force_login(self.peer)

        with patch("chat.api.add_reaction", side_effect=MessageForbiddenError("forbidden")):
            forbidden = self.client.post(
                f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/reactions/",
                data=json.dumps({"emoji": "👍"}),
                content_type="application/json",
            )
        self.assertEqual(forbidden.status_code, 403)

        added = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/reactions/",
            data=json.dumps({"emoji": "👍"}),
            content_type="application/json",
        )
        self.assertEqual(added.status_code, 200)
        self.assertTrue(
            Reaction.objects.filter(message=message, user=self.peer, emoji="👍").exists()
        )

        removed = self.client.delete(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/{message.pk}/reactions/%F0%9F%91%8D/"
        )
        self.assertEqual(removed.status_code, 204)
        self.assertFalse(
            Reaction.objects.filter(message=message, user=self.peer, emoji="👍").exists()
        )

    def test_search_messages_handles_validation_and_pagination(self):
        first = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="needle first",
        )
        second = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="needle second",
        )
        Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="other",
        )

        self.client.force_login(self.owner)
        short = self.client.get(f"/api/chat/rooms/{self.direct_room.slug}/messages/search/?q=x")
        self.assertEqual(short.status_code, 400)

        page = self.client.get(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/search/?q=needle&limit=1&before=bad"
        )
        self.assertEqual(page.status_code, 200)
        payload = page.json()
        self.assertEqual(payload["pagination"]["limit"], 1)
        self.assertTrue(payload["pagination"]["hasMore"])
        self.assertEqual(len(payload["results"]), 1)

        before_filtered = self.client.get(
            f"/api/chat/rooms/{self.direct_room.slug}/messages/search/?q=needle&before={second.pk}"
        )
        self.assertEqual(before_filtered.status_code, 200)
        ids = {item["id"] for item in before_filtered.json()["results"]}
        self.assertIn(first.pk, ids)
        self.assertNotIn(second.pk, ids)

    def test_mark_read_validation_public_short_circuit_and_unread_counts(self):
        message = Message.objects.create(
            username=self.peer.username,
            user=self.peer,
            room=self.direct_room,
            message_content="for unread",
        )
        self.client.force_login(self.owner)

        bool_payload = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/read/",
            data=json.dumps({"lastReadMessageId": True}),
            content_type="application/json",
        )
        self.assertEqual(bool_payload.status_code, 400)

        negative_payload = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/read/",
            data=json.dumps({"lastReadMessageId": -1}),
            content_type="application/json",
        )
        self.assertEqual(negative_payload.status_code, 400)

        unread_before = self.client.get("/api/chat/rooms/unread/")
        self.assertEqual(unread_before.status_code, 200)
        self.assertTrue(any(item["roomSlug"] == self.direct_room.slug for item in unread_before.json()["items"]))

        read_ok = self.client.post(
            f"/api/chat/rooms/{self.direct_room.slug}/read/",
            data=json.dumps({"lastReadMessageId": message.pk}),
            content_type="application/json",
        )
        self.assertEqual(read_ok.status_code, 200)

        unread_after = self.client.get("/api/chat/rooms/unread/")
        self.assertEqual(unread_after.status_code, 200)
        self.assertFalse(any(item["roomSlug"] == self.direct_room.slug for item in unread_after.json()["items"]))

        public_short = self.client.post(
            "/api/chat/rooms/public/read/",
            data=json.dumps({"lastReadMessageId": 1}),
            content_type="application/json",
        )
        self.assertEqual(public_short.status_code, 200)
        self.assertIsNone(public_short.json()["lastReadMessageId"])
