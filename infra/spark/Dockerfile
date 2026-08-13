# Spark image with two storage stacks baked in:
#  - s3a (hadoop-aws + matching aws-java-sdk-bundle) to READ the raw parquet source;
#  - Iceberg runtime + iceberg-aws-bundle (AWS SDK v2 S3FileIO) to WRITE Iceberg tables
#    to MinIO via the Nessie REST catalog.
# Versions must match Spark 3.5.3 (Hadoop 3.3.4, Scala 2.12). Iceberg 1.11.0 is compiled
# for Java 17, but the arm64 Spark 3.5.3 images (incl. the *-java17-* tag) ship Java 11 —
# so we install a JDK 17 and point JAVA_HOME at it. Iceberg 1.11.0 pairs with Nessie 0.108.x.
FROM apache/spark:3.5.3
USER root
ARG ICEBERG_VER=1.11.0
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64
ENV PATH=${JAVA_HOME}/bin:${PATH}
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates openjdk-17-jre-headless \
 && rm -rf /var/lib/apt/lists/* \
 && cd /opt/spark/jars \
 && curl -fsSLO https://repo1.maven.org/maven2/org/apache/hadoop/hadoop-aws/3.3.4/hadoop-aws-3.3.4.jar \
 && curl -fsSLO https://repo1.maven.org/maven2/com/amazonaws/aws-java-sdk-bundle/1.12.262/aws-java-sdk-bundle-1.12.262.jar \
 && curl -fsSLO https://repo1.maven.org/maven2/org/apache/iceberg/iceberg-spark-runtime-3.5_2.12/${ICEBERG_VER}/iceberg-spark-runtime-3.5_2.12-${ICEBERG_VER}.jar \
 && curl -fsSLO https://repo1.maven.org/maven2/org/apache/iceberg/iceberg-aws-bundle/${ICEBERG_VER}/iceberg-aws-bundle-${ICEBERG_VER}.jar
COPY job.py /opt/spark/work-dir/job.py
USER spark
