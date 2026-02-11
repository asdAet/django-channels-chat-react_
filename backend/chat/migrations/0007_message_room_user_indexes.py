from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0006_message_user"),
    ]

    operations = [
        migrations.AlterField(
            model_name="message",
            name="username",
            field=models.CharField(db_index=True, max_length=50),
        ),
        migrations.AlterField(
            model_name="message",
            name="room",
            field=models.CharField(db_index=True, max_length=50),
        ),
        migrations.AlterField(
            model_name="message",
            name="date_added",
            field=models.DateTimeField(db_index=True, default=django.utils.timezone.now),
        ),
        migrations.AlterField(
            model_name="room",
            name="name",
            field=models.CharField(db_index=True, max_length=50),
        ),
        migrations.AddIndex(
            model_name="message",
            index=models.Index(fields=["room", "date_added"], name="chat_msg_room_date_idx"),
        ),
        migrations.AddIndex(
            model_name="message",
            index=models.Index(fields=["username", "date_added"], name="chat_msg_user_date_idx"),
        ),
    ]
