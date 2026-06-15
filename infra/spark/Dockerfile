# Spark image with the s3a stack (hadoop-aws + matching aws-java-sdk-bundle) baked in,
# plus the job. Versions must match Spark 3.5.3's bundled Hadoop 3.3.4.
FROM apache/spark:3.5.3
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && cd /opt/spark/jars \
 && curl -fsSLO https://repo1.maven.org/maven2/org/apache/hadoop/hadoop-aws/3.3.4/hadoop-aws-3.3.4.jar \
 && curl -fsSLO https://repo1.maven.org/maven2/com/amazonaws/aws-java-sdk-bundle/1.12.262/aws-java-sdk-bundle-1.12.262.jar
COPY job.py /opt/spark/work-dir/job.py
USER spark
