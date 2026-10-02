package br.com.vendua.impressora.update

object SemVer {
    /** major.minor.patch; a leading "v" and any pre-release/build suffix are ignored. */
    fun parse(version: String): Triple<Int, Int, Int>? {
        val core = version.trim().removePrefix("v").substringBefore('-').substringBefore('+')
        val parts = core.split('.')
        if (parts.size != 3) return null
        val nums = parts.map { it.toIntOrNull()?.takeIf { n -> n >= 0 } ?: return null }
        return Triple(nums[0], nums[1], nums[2])
    }

    fun compare(a: String, b: String): Int {
        val x = parse(a) ?: return 0
        val y = parse(b) ?: return 0
        return compareValuesBy(x, y, { it.first }, { it.second }, { it.third })
    }

    fun isNewer(candidate: String, current: String): Boolean =
        parse(candidate) != null && parse(current) != null && compare(candidate, current) > 0

    /** Must match versionCodeOf() in app/build.gradle.kts. */
    fun versionCode(version: String): Int {
        val (major, minor, patch) = requireNotNull(parse(version)) { "not semver: $version" }
        require(minor < 100 && patch < 100)
        return major * 10_000 + minor * 100 + patch
    }
}
