# kotlinx-serialization: keep generated serializers and the companion lookups for our @Serializable models.
-keepattributes *Annotation*, InnerClasses, Signature
-dontnote kotlinx.serialization.**

-keepclassmembers @kotlinx.serialization.Serializable class br.com.vendua.impressora.** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class br.com.vendua.impressora.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class br.com.vendua.impressora.**$$serializer { *; }
-if @kotlinx.serialization.Serializable class br.com.vendua.impressora.**
-keepclassmembers class br.com.vendua.impressora.<1>$Companion {
    kotlinx.serialization.KSerializer serializer(...);
}

# zxing core ships no rules; only the QR encoder is used.
-dontwarn com.google.zxing.**
