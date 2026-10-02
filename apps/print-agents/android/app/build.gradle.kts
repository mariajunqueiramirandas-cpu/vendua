import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Shared with the Windows agent: apps/print-agents/VERSION.
val agentVersion: String = rootProject.file("../VERSION").readText().trim()

fun versionCodeOf(version: String): Int {
    val parts = version.substringBefore('-').split('.').map { it.toInt() }
    require(parts.size == 3) { "VERSION must be major.minor.patch, got $version" }
    val (major, minor, patch) = parts
    require(minor < 100 && patch < 100) { "minor/patch must be < 100 for versionCode, got $version" }
    return major * 10000 + minor * 100 + patch
}

val keystorePath: String? = System.getenv("VENDUA_KEYSTORE")?.takeIf { it.isNotBlank() }

android {
    namespace = "br.com.vendua.impressora"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "br.com.vendua.impressora"
        minSdk = 26
        targetSdk = 36
        versionName = agentVersion
        versionCode = versionCodeOf(agentVersion)
        buildConfigField("String", "API_BASE", "\"https://painel.vendua.com.br\"")
    }

    androidResources {
        localeFilters += listOf("pt", "pt-rBR")
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("VENDUA_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("VENDUA_KEY_ALIAS")
                keyPassword = System.getenv("VENDUA_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += listOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/versions/9/OSGI-INF/MANIFEST.MF")
    }

    testOptions {
        unitTests.all {
            it.testLogging {
                events("failed")
                exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
            }
        }
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        textReport = true
        // Versions are pinned on purpose: newer AndroidX/Compose need compileSdk 37 + AGP 9 (see libs.versions.toml).
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    implementation(libs.zxing.core)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
